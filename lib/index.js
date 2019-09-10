"use strict";

/* eslint-disable complexity, no-magic-numbers, max-statements */

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

const { WRAPPED_FN, IS_FINALLY } = require("./symbols");

function detectWantCallbackByParamName(checkFunc, index, done) {
  // takes single param, ambiguous function type
  // function could be asking for next cb
  // or want the previous result
  const funcStr = checkFunc.toString();
  let params;

  // match fat arrow function
  const fatIx = funcStr.indexOf("=>");

  if (fatIx > 0) {
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

function runVerify(...args) {
  const finallyCbs = args.filter(x => x[IS_FINALLY] === true);
  const checkFuncs = args.filter(x => x[IS_FINALLY] !== true);

  const lastIx = checkFuncs.length - 1;
  const done = checkFuncs[lastIx];
  let index = 0;

  if (checkFuncs.length < 2) {
    throw new Error("runVerify - must pass done function");
  }

  const invokeFinally = (err, result) => {
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
    if (index >= lastIx) {
      return invokeFinally(undefined, prevResult);
    }

    let wrap = {};
    let checkFunc = checkFuncs[index];
    if (checkFunc.hasOwnProperty(WRAPPED_FN)) {
      wrap = checkFunc;
      // skip onFailVerify functions
      if (wrap._onFailVerify) {
        index++;
        return invokeCheckFunc(prevResult);
      }
      checkFunc = wrap[WRAPPED_FN];
    }

    const tof = typeof checkFunc;
    if (tof !== "function") {
      return invokeFinally(new Error(`runVerify param ${index} is not a function: type ${tof}`));
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
      return new Error(`runVerify expecting error from check function number ${prevIndex}`);
    };

    const invokeWithExpectError = err => {
      if (wrap._expectError === "has") {
        if (err.message.indexOf(wrap._expectErrorMsg) < 0) {
          return invokeFinally(
            new Error(`runVerify expecting error with message has '${wrap._expectErrorMsg}'`)
          );
        }
      } else if (wrap._expectError === "toBe") {
        if (err.message !== wrap._expectErrorMsg) {
          return invokeFinally(
            new Error(`runVerify expecting error with message to be '${wrap._expectErrorMsg}'`),
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

function asyncVerify(...args) {
  return new Promise((resolve, reject) => {
    runVerify(...args, (err, res) => {
      if (err) return reject(err);
      return resolve(res);
    });
  });
}

function wrapAsyncVerify(...args) {
  return x => asyncVerify(() => x, ...args);
}

function wrapVerify(...args) {
  return x => runVerify(() => x, ...args);
}

const wrapFn = fn => {
  return { [WRAPPED_FN]: fn };
};

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

  return wrap;
};

const expectError = fn => {
  return wrapCheck(fn).expectError;
};

const expectErrorHas = (fn, msg) => {
  return wrapCheck(fn).expectErrorHas(msg);
};

const expectErrorToBe = (fn, msg) => {
  return wrapCheck(fn).expectErrorToBe(msg);
};

const onFailVerify = fn => {
  return wrapCheck(fn).onFailVerify;
};

const withCallback = fn => {
  return wrapCheck(fn).withCallback;
};

const runFinally = fn => {
  const wrap = wrapFn(fn);
  wrap[IS_FINALLY] = true;
  return wrap;
};

module.exports = {
  runVerify,
  wrapVerify,
  asyncVerify,
  wrapAsyncVerify,
  wrapCheck,
  expectError,
  expectErrorHas,
  expectErrorToBe,
  onFailVerify,
  withCallback,
  runFinally
};
