/**
 * @typedef {Function} CheckFunction
 * @description A function that performs a verification check
 * @param {*} [result] - Result from previous check function
 * @param {Function} [next] - Callback to continue to next check function
 * @returns {Promise<*>|*} - May return a promise or value directly
 */

/**
 * @typedef {Object} DeferObject
 * @property {number} timeout - Timeout duration in milliseconds
 * @property {EventEmitter} event - Event emitter for defer operations
 * @property {Object} handlers - Resolve and reject handlers
 * @property {Function} resolve - Resolves the deferred operation
 * @property {Function} reject - Rejects the deferred operation
 * @property {Function} onResolve - Adds a resolve handler
 * @property {Function} onReject - Adds a reject handler
 * @property {Function} pending - Checks if defer is still pending
 * @property {Function} clear - Clears the defer state
 * @property {Function} wait - Waits for defer to complete
 * @property {Function} waitAgain - Waits again for defer to complete
 */

"use strict";

/* eslint-disable complexity, no-magic-numbers, max-statements, prefer-const */

//
// runVerify(checkFunc1, [checkFunc2, ..., checkFuncN], doneFunc);
//
// Will call each checkFunc in series.
//
// checkFunc can take 0, 1, or 2 params
//
// For 0 param:
//   - return a promise if it wants to be async
//     - its resolved value used as result for next checkFunc
//   - or only sync (its returned value used as result for next checkFunc)
//
// For 1 param: (next) or (result)
//   - take a next callback (param name must start with one of: next, cb, callback, done)
//   - take a result
//     - return a promise if it wants to be async
//       - its resolved value used as result for next checkFunc
//     - or only sync (its returned value used as result for next checkFunc)
//
// For 2 params: (result, next)
//   - result - result from previous checkFunc
//   - next - callback to continue to next checkFunc
//
// If async/await is supported natively, then checkFunc can be async and will
// always be treated as a promise returning function.
//
// For next callback: (err, result)
//
// If any checkFunc throws or call next with err, then execution terminates
// and done is called with err.
//
// If all checkFunc completed successfully, done is called with (null, result)
//

const assert = require("assert");
const { EventEmitter } = require("events");

const { WRAPPED_FN, IS_FINALLY, DEFER_EVENT, DEFER_WAIT, DEFER_OBJ } = require("./symbols");

function detectWantCallbackByParamName(checkFunc, index, done) {
  // takes single param, ambiguous function type
  // function could be asking for next cb
  // or want the previous result
  const funcStr = checkFunc.toString().trim();
  let params;

  // match fat arrow function
  const fatIx = funcStr.indexOf("=>");

  if (fatIx > 0 && (funcStr.startsWith("()") || funcStr[0] !== "(")) {
    // () => ...
    // next => ...
    params = funcStr.substring(0, fatIx);
  } else {
    // match for (param)
    const match = funcStr.match(/^[^\(]*\(([^\)]+)\)/);
    /* istanbul ignore next */
    if (!match || !match[1]) {
      /* istanbul ignore next */
      return done(new Error(`runVerify param ${index} unable to match arg name`));
    }
    params = match[1];
  }

  params = params.trim().toLowerCase();

  return (
    params.startsWith("next") ||
    params.startsWith("cb") ||
    params.startsWith("callback") ||
    params.startsWith("done")
  );
}

const errorMsg = (error, message) => {
  error.message = message;
  return error;
};

function _runVerify(args, errorFromCall) {
  const finallyCbs = args.filter(x => x[IS_FINALLY] === true);
  const checkFuncs = args.filter(x => x[IS_FINALLY] !== true);

  const lastIx = checkFuncs.length - 1;
  const done = checkFuncs[lastIx];
  let index = 0;
  let timeoutTimer;
  let failError;
  const defers = [];
  let completed;

  if (checkFuncs.length < 2) {
    throw errorMsg(errorFromCall, "runVerify - must pass done function");
  }

  const invokeFinally = (err, result) => {
    assert(!completed, "bug: invokeFinally already called");
    completed = true;
    failError = err && errorMsg(errorFromCall, err.message);

    const onFail = checkFuncs[index];
    let error = err;

    if (err && onFail && onFail[WRAPPED_FN] && onFail._onFailVerify) {
      try {
        onFail[WRAPPED_FN](err, result);
      } catch (err2) {
        error = err2;
      }
    }

    let returnFinallyCbs = [];

    try {
      finallyCbs.forEach(wrap => returnFinallyCbs.push(wrap[WRAPPED_FN]()));
      returnFinallyCbs = returnFinallyCbs.filter(x => x);
    } catch (err2) {
      error = err2;
    }

    const invokeDone = () => {
      clearTimeout(timeoutTimer);
      if (done.length > 1) {
        return done(error, result);
      } else {
        return done(error);
      }
    };

    if (returnFinallyCbs.length > 0) {
      Promise.all(returnFinallyCbs)
        .catch(err2 => {
          if (!error) error = err2;
        })
        .then(invokeDone);
    } else {
      invokeDone();
    }
  };

  const invokeCheckFunc = prevResult => {
    if (failError) {
      return undefined;
    }

    if (index >= lastIx) {
      if (defers.length && !defers.every(x => x.invoked)) {
        // wait for all defer to resolve
        return undefined;
      }
      return invokeFinally(undefined, prevResult);
    }

    const nextCheckFunc = r => {
      index++;
      return invokeCheckFunc(r);
    };

    let wrap = {};
    let checkFunc = checkFuncs[index];

    const addDefer = defer => {
      defers.push(defer);

      const invokeDeferHandlers = (handlers, value) => {
        for (const h of handlers) {
          try {
            h(value);
          } catch (err) {
            defer.failed = true;
            defer.error = err;
            break;
          }
        }
        return undefined;
      };

      const onDefer = (err, r) => {
        if (!failError && !defer.invoked) {
          defer.invoked = true;
          if (!err) {
            invokeDeferHandlers(defer.handlers.resolve, r);
          } else {
            invokeDeferHandlers(defer.handlers.reject, err);
          }

          const errors = defers.map(x => x.error).filter(x => x);
          // fail as soon as a defer failed
          if (errors.length > 0) {
            if (!defer[DEFER_WAIT]) {
              return invokeFinally(errors[0]);
            } else {
              return undefined;
            }
          }
          //
          // If:
          //  - defer is not waiting - all defers resolved - and all checkFunc executed
          // Then: - finish test with invokeFinally
          //
          if (!defer._waiting && defers.every(x => x.invoked) && index >= lastIx) {
            const results = defers.map(x => x.result);
            return invokeFinally(undefined, results.length === 1 ? results[0] : results);
          }
        }
        return undefined;
      };

      defer.setAwait({
        resolve: r => onDefer(undefined, r),
        reject: err => onDefer(err),
        errorFromCall,
        timeoutMsg: `from runVerify`,
        waitTimeout: defer.timeout
      });
    };

    if (checkFunc.hasOwnProperty(WRAPPED_FN)) {
      wrap = checkFunc;
      // skip onFailVerify functions
      if (wrap._onFailVerify) {
        return nextCheckFunc(prevResult);
      }
      if (wrap._timeout) {
        clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => {
          failError = errorMsg(
            errorFromCall,
            `runVerify: test timeout after ${wrap._timeout}ms while waiting for \
run check function number ${index + 1}`
          );
          wrap[WRAPPED_FN](failError);
          invokeFinally(failError);
        }, wrap._timeout);
        return nextCheckFunc(prevResult);
      }
      checkFunc = wrap[WRAPPED_FN];
    }

    if (checkFunc[DEFER_EVENT]) {
      const defer = checkFunc[DEFER_OBJ] || checkFunc;
      if (defers.indexOf(defer) < 0) {
        addDefer(defer);
      }

      if (!defer[DEFER_WAIT] || checkFunc === defer) {
        return setTimeout(() => nextCheckFunc(prevResult));
      }
    }

    const tof = typeof checkFunc;
    if (tof !== "function") {
      return invokeFinally(
        errorMsg(errorFromCall, `runVerify param ${index} is not a function: type ${tof}`)
      );
    }

    let cbNext;
    let wantResult = checkFunc.length > 0;

    if (checkFunc.constructor.name === "AsyncFunction") {
      cbNext = false;
    } else if (checkFunc.length > 1) {
      cbNext = true;
    } else if (
      wrap._withCallback === true ||
      detectWantCallbackByParamName(checkFunc, index, invokeFinally)
    ) {
      cbNext = true;
      wantResult = false;
    }

    const prevIndex = index++;

    const expectError = Boolean(wrap._expectError);
    const failExpectError = () => {
      return errorMsg(
        errorFromCall,
        `runVerify expecting error from check function number ${prevIndex}`
      );
    };

    const invokeWithExpectError = err => {
      if (wrap._expectError === "has") {
        if (err.message.indexOf(wrap._expectErrorMsg) < 0) {
          return invokeFinally(
            errorMsg(
              errorFromCall,
              `runVerify expecting error with message has '${wrap._expectErrorMsg}'`
            )
          );
        }
      } else if (wrap._expectError === "toBe") {
        if (err.message !== wrap._expectErrorMsg) {
          return invokeFinally(
            errorMsg(
              errorFromCall,
              `runVerify expecting error with message to be '${wrap._expectErrorMsg}'`
            ),
            undefined,
            index
          );
        }
      }

      return invokeCheckFunc(err);
    };

    if (cbNext) {
      try {
        const next = expectError
          ? err => {
              if (err) return invokeWithExpectError(err);
              return invokeFinally(failExpectError());
            }
          : (err, r) => {
              if (err) return invokeFinally(err);
              return invokeCheckFunc(r);
            };

        if (wantResult) {
          return checkFunc(prevResult, next);
        } else {
          return checkFunc(next);
        }
      } catch (err) {
        return expectError ? invokeWithExpectError(err) : invokeFinally(err);
      }
    } else {
      let result;

      try {
        if (wantResult) {
          result = checkFunc(prevResult);
        } else {
          result = checkFunc();
        }
      } catch (err) {
        return expectError ? invokeWithExpectError(err) : invokeFinally(err);
      }

      if (result && result.then && result.catch) {
        if (expectError) {
          let error;
          return result
            .catch(err => {
              error = err;
            })
            .then(() => {
              if (error === undefined) {
                return invokeFinally(failExpectError());
              } else {
                return invokeWithExpectError(error);
              }
            });
        } else {
          return result.then(invokeCheckFunc).catch(invokeFinally);
        }
      } else if (expectError) {
        return invokeFinally(failExpectError());
      } else {
        return invokeCheckFunc(result);
      }
    }
  };

  invokeCheckFunc();
}

/**
 * Runs a series of check functions in sequence, with support for async operations
 * @param {...CheckFunction} args - Check functions to run in sequence, last argument is done callback
 * @description
 * Will call each checkFunc in series.
 *
 * checkFunc can take 0, 1, or 2 params:
 *
 * For 0 param:
 *   - return a promise if it wants to be async
 *     - its resolved value used as result for next checkFunc
 *   - or only sync (its returned value used as result for next checkFunc)
 *
 * For 1 param: (next) or (result)
 *   - take a next callback (param name must start with one of: next, cb, callback, done)
 *   - take a result
 *     - return a promise if it wants to be async
 *       - its resolved value used as result for next checkFunc
 *     - or only sync (its returned value used as result for next checkFunc)
 *
 * For 2 params: (result, next)
 *   - result - result from previous checkFunc
 *   - next - callback to continue to next checkFunc
 */
function runVerify(...args) {
  const errorFromCall = new Error();
  /* istanbul ignore next */
  if (Error.captureStackTrace) {
    /* istanbul ignore next */
    Error.captureStackTrace(errorFromCall, runVerify);
  }

  return _runVerify(args, errorFromCall);
}

/**
 * Promise-based version of runVerify
 * @param {...CheckFunction} args - Check functions to run in sequence
 * @returns {Promise<*>} Promise that resolves with the final result or rejects with an error
 */
function asyncVerify(...args) {
  const errorFromCall = new Error();
  /* istanbul ignore next */
  if (Error.captureStackTrace) {
    /* istanbul ignore next */
    Error.captureStackTrace(errorFromCall, asyncVerify);
  }

  return new Promise((resolve, reject) => {
    _runVerify([...args, (err, res) => (err ? reject(err) : resolve(res))], errorFromCall);
  });
}

/**
 * Creates a function that wraps a value in asyncVerify
 * @param {...CheckFunction} args - Check functions to run after the wrapped value
 * @returns {Function} Function that takes a value and runs asyncVerify with it
 */
function wrapAsyncVerify(...args) {
  return x => asyncVerify(() => x, ...args);
}

/**
 * Creates a function that wraps a value in runVerify
 * @param {...CheckFunction} args - Check functions to run after the wrapped value
 * @returns {Function} Function that takes a value and runs runVerify with it
 */
function wrapVerify(...args) {
  return x => runVerify(() => x, ...args);
}

/**
 * Basic function wrapper that marks a function with WRAPPED_FN symbol
 * @param {Function} fn - Function to wrap
 * @returns {Object} Wrapped function object
 */
const wrapFn = fn => {
  return { [WRAPPED_FN]: fn };
};

/**
 * Wraps a check function with additional verification capabilities
 * @param {Function} fn - Function to wrap
 * @returns {Object} Wrapped function with additional properties for verification
 */
const wrapCheck = fn => {
  const wrap = wrapFn(fn);

  Object.defineProperty(wrap, "expectError", {
    get() {
      wrap._expectError = true;
      return wrap;
    }
  });

  Object.defineProperty(wrap, "withCallback", {
    get() {
      wrap._withCallback = true;
      return wrap;
    }
  });

  Object.defineProperty(wrap, "onFailVerify", {
    get() {
      wrap._onFailVerify = true;
      return wrap;
    }
  });

  wrap.expectErrorHas = msg => {
    wrap._expectError = "has";
    wrap._expectErrorMsg = msg;
    return wrap;
  };

  wrap.expectErrorToBe = msg => {
    wrap._expectError = "toBe";
    wrap._expectErrorMsg = msg;
    return wrap;
  };

  wrap.runTimeout = delay => {
    wrap._timeout = delay;
    return wrap;
  };

  return wrap;
};

/**
 * Marks a check function to expect an error
 * @param {Function} fn - Function to wrap
 * @returns {Object} Wrapped function that expects an error
 */
const expectError = fn => {
  return wrapCheck(fn).expectError;
};

/**
 * Marks a check function to expect an error containing specific text
 * @param {Function} fn - Function to wrap
 * @param {string} msg - Text that should be contained in the error
 * @returns {Object} Wrapped function that expects an error with specific text
 */
const expectErrorHas = (fn, msg) => {
  return wrapCheck(fn).expectErrorHas(msg);
};

/**
 * Marks a check function to expect an exact error message
 * @param {Function} fn - Function to wrap
 * @param {string} msg - Exact error message to expect
 * @returns {Object} Wrapped function that expects an exact error message
 */
const expectErrorToBe = (fn, msg) => {
  return wrapCheck(fn).expectErrorToBe(msg);
};

/**
 * Marks a function to be called on verification failure
 * @param {Function} fn - Function to wrap
 * @returns {Object} Wrapped function to be called on failure
 */
const onFailVerify = fn => {
  return wrapCheck(fn).onFailVerify;
};

/**
 * Marks a function as using callbacks
 * @param {Function} fn - Function to wrap
 * @returns {Object} Wrapped function marked as using callbacks
 */
const withCallback = fn => {
  return wrapCheck(fn).withCallback;
};

/**
 * Creates a timeout check function
 * @param {number} delay - Timeout duration in milliseconds
 * @param {Function} [fn] - Optional function to run before timeout
 * @returns {Object} Wrapped function with timeout
 */
const runTimeout = (delay, fn) => {
  return wrapCheck(fn || (() => {})).runTimeout(delay);
};

/**
 * Creates a deferred object for handling async operations
 * @param {number} timeout - Timeout duration in milliseconds
 * @returns {DeferObject} Deferred object with event handling capabilities
 */
const runDefer = timeout => {
  const event = new EventEmitter();
  const handlers = {
    resolve: [],
    reject: []
  };

  const d = {
    timeout,
    event,
    handlers,
    [DEFER_EVENT]: event,
    resolve(r) {
      event.emit("resolve", r);
      if (!this._waiting && !this.invoked) {
        this.invoked = true;
        this.result = r;
      }
    },
    reject(err) {
      event.emit("reject", err);
      if (!this._waiting && !this.invoked) {
        this.invoked = true;
        this.failed = true;
        this.error = err;
      }
    },
    onResolve(cb) {
      handlers.resolve.push(cb);
      return d;
    },
    onReject(cb) {
      handlers.reject.push(cb);
      return d;
    },
    pending() {
      return !d.invoked;
    },
    clear() {
      const fn = () => {
        if (d._waited) {
          d._waited = false;
        }
        if (d.invoked) {
          d.invoked = false;
          d.failed = false;
        }
      };

      fn();

      return fn;
    },
    setAwait({ resolve, reject, errorFromCall, timeoutMsg, waitTimeout }) {
      if (d.invoked) {
        if (d.failed) {
          reject(d.error);
        } else {
          resolve(d.result);
        }
      } else {
        d._waiting = true;

        let timer;
        let handler;
        const resolveCb = r => handler("resolve", r);
        const rejectCb = err => handler("reject", err);

        handler = (type, v) => {
          clearTimeout(timer);
          d._waiting = false;
          event.removeListener("resolve", resolveCb);
          event.removeListener("reject", rejectCb);
          if (type === "reject") {
            d.failed = true;
            d.error = v;
            reject(v);
          } else {
            d.result = v;
            resolve(v);
          }
          // set this last, to allow resolve/reject to handle it if they need to
          d.invoked = true;
        };

        event.on("resolve", resolveCb);
        event.on("reject", rejectCb);

        if (waitTimeout > 0) {
          timer = setTimeout(() => {
            return (
              d.invoked ||
              event.emit(
                "reject",
                errorMsg(errorFromCall, `defer timeout after ${waitTimeout}ms - ${timeoutMsg}`)
              )
            );
          }, waitTimeout).unref();
        }
      }
    },
    waitAgain(waitTimeout) {
      return d.wait(waitTimeout, true);
    },
    wait(waitTimeout, again) {
      const errorFromCall = new Error();
      /* istanbul ignore next */
      if (Error.captureStackTrace) {
        /* istanbul ignore next */
        Error.captureStackTrace(errorFromCall, d.wait);
      }

      const waitFn = () => {
        const canWait = again || !d._waited;
        assert(
          canWait,
          "defer already waited. To wait again, call waitAgain([ms]) or wait([ms], true), or you should clear it first."
        );
        d._waited = true;

        return new Promise((resolve, reject) => {
          d.setAwait({
            resolve,
            reject,
            errorFromCall,
            timeoutMsg: "from defer.wait",
            waitTimeout
          });
        });
      };
      d[DEFER_WAIT] = true;
      waitFn[DEFER_OBJ] = d;
      waitFn[DEFER_EVENT] = event;

      return waitFn;
    }
  };
  return d;
};

/**
 * Creates a function to be run at the end of verification
 * @param {Function} fn - Function to run at the end
 * @returns {Object} Wrapped function marked as a finally handler
 */
const runFinally = fn => {
  const wrap = wrapFn(fn);
  wrap[IS_FINALLY] = true;
  return wrap;
};

/**
 * @module run-verify
 */
module.exports = {
  /** Run verification checks in sequence */
  runVerify,
  /** Create a function that wraps a value in runVerify */
  wrapVerify,
  /** Run verification checks in sequence, returning a promise */
  asyncVerify,
  /** Create a function that wraps a value in asyncVerify */
  wrapAsyncVerify,
  /** Wrap a check function with additional capabilities */
  wrapCheck,
  /** Mark a function to expect an error */
  expectError,
  /** Mark a function to expect an error containing specific text */
  expectErrorHas,
  /** Mark a function to expect an exact error message */
  expectErrorToBe,
  /** Mark a function to be called on verification failure */
  onFailVerify,
  /** Mark a function as using callbacks */
  withCallback,
  /** Create a timeout check function */
  runTimeout,
  /** Create a function to run at the end of verification */
  runFinally,
  /** Create a deferred object for handling async operations */
  runDefer
};
