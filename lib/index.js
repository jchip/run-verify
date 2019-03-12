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
  const finallyCbs = args.filter(x => x._isFinally === true);
  const checkFuncs = args.filter(x => x._isFinally !== true);

  const lastIx = checkFuncs.length - 1;
  const done = checkFuncs[lastIx];

  if (checkFuncs.length < 2) {
    throw new Error("runVerify - must pass done function");
  }

  const invokeFinally = (err, result) => {
    let fr = [];
    let error = err;

    try {
      finallyCbs.forEach(fn => fr.push(fn()));
      fr = fr.filter(x => x);
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

    if (fr.length > 0) {
      Promise.all(fr)
        .catch(err2 => {
          if (!error) error = err2;
        })
        .then(invokeDone);
    } else {
      invokeDone();
    }
  };

  let index = 0;

  const invokeCheckFunc = prevResult => {
    if (index >= lastIx) {
      return invokeFinally(undefined, prevResult);
    }

    const checkFunc = checkFuncs[index];

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
      checkFunc._withCallback === true ||
      detectWantCallbackByParamName(checkFunc, index, invokeFinally)
    ) {
      cbNext = true;
      wantResult = false;
    }

    const prevIndext = index;

    const expectError = Boolean(checkFunc._expectError);
    const failExpectError = () => {
      return new Error(`runVerify expecting error from check function number ${prevIndext}`);
    };
    const invokeWithExpectError = err => {
      if (checkFunc._expectError === "has") {
        if (err.message.indexOf(checkFunc._expectErrorMsg) < 0) {
          return invokeFinally(
            new Error(`runVerify expecting error with message has '${checkFunc._expectErrorMsg}'`)
          );
        }
      } else if (checkFunc._expectError === "toBe") {
        if (err.message !== checkFunc._expectErrorMsg) {
          return invokeFinally(
            new Error(`runVerify expecting error with message to be '${checkFunc._expectErrorMsg}'`)
          );
        }
      }

      return invokeCheckFunc(err);
    };

    index++;

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

const wrapCheck = fn => {
  Object.defineProperty(fn, "expectError", {
    get() {
      fn._expectError = true;
      return fn;
    }
  });

  Object.defineProperty(fn, "withCallback", {
    get() {
      fn._withCallback = true;
      return fn;
    }
  });

  fn.expectErrorHas = msg => {
    fn._expectError = "has";
    fn._expectErrorMsg = msg;
    return fn;
  };

  fn.expectErrorToBe = msg => {
    fn._expectError = "toBe";
    fn._expectErrorMsg = msg;
    return fn;
  };

  return fn;
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

const withCallback = fn => {
  return wrapCheck(fn).withCallback;
};

const runFinally = fn => {
  fn._isFinally = true;
  return fn;
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
  withCallback,
  runFinally
};
