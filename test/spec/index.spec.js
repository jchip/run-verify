"use strict";

const {
  runVerify,
  wrapVerify,
  asyncVerify,
  wrapAsyncVerify,
  expectError,
  expectErrorHas,
  expectErrorToBe,
  withCallback,
  wrapCheck
} = require("../..");

const fooEvent = (delay, cb) => setTimeout(() => cb(null, "foo"), delay);
const fooErrorEvent = (delay, cb) => setTimeout(() => cb(new Error("foo failed")), delay);

describe("runVerify", function() {
  it("should verify async event returning unexpected result", done => {
    runVerify(
      next => fooEvent(1, next),
      data => {
        expect(data).to.equal("blah");
      },
      err => {
        try {
          expect(err, "last expect should've failed").to.exist;
          expect(err.message).includes(`'foo' to equal 'blah'`);
          done();
        } catch (err2) {
          done(err2);
        }
      }
    );
  });

  it("should verify async event returning error", done => {
    runVerify(
      expectError(next => {
        fooErrorEvent(1, next);
      }),
      done
    );
  });

  it("should pass error from async event to next check func", done => {
    runVerify(
      wrapCheck(next => {
        fooErrorEvent(1, next);
      }).expectError,
      err => {
        expect(err.message).includes("foo failed");
      },
      done
    );
  });

  it("should verify async event error _has_ msg and pass to next check func", done => {
    runVerify(
      expectErrorHas(next => {
        fooErrorEvent(1, next);
      }, "oo failed"),
      done
    );
  });

  it("should verify async event error _equal_ msg and pass to next check func", done => {
    runVerify(
      expectErrorToBe(next => {
        fooErrorEvent(1, next);
      }, "foo failed"),
      done
    );
  });

  it("should fail async event error _not has_ msg", done => {
    runVerify(
      expectErrorHas(next => {
        runVerify(expectErrorHas(next2 => fooErrorEvent(1, next2), "blahblah"), next);
      }, "with message has 'blahblah'"),
      done
    );
  });

  it("should fail async event error _not equal_ msg", done => {
    runVerify(
      expectErrorHas(next => {
        runVerify(expectErrorToBe(next2 => fooErrorEvent(1, next2), "blahblah"), next);
      }, "with message to be 'blahblah'"),
      done
    );
  });

  it("should fail if expectError check func didn't return error", done => {
    runVerify(
      expectError(next => {
        runVerify(
          expectError(next2 => {
            fooEvent(1, next2);
          }),
          next
        );
      }),
      err => {
        expect(err.message).includes("runVerify expecting error from check function number 0");
      },
      done
    );
  });

  it("should fail if check func invoke callback with error", done => {
    runVerify(
      expectError(next => {
        runVerify(cb => cb(new Error("fail me")), next);
      }),
      err => {
        expect(err.message).includes("fail me");
      },
      done
    );
  });

  it("should fail if check func throws error", done => {
    runVerify(
      expectError(next => {
        // eslint-disable-next-line
        runVerify(cb => {
          throw new Error("test oops");
        }, next);
      }),
      err => {
        expect(err.message).includes("test oops");
      },
      done
    );
  });

  it("should handle if expectError check func throws error", done => {
    runVerify(
      // eslint-disable-next-line
      expectError(next => {
        throw new Error("test oops");
      }),
      err => {
        expect(err.message).includes("test oops");
      },
      done
    );
  });

  it("should handle error from expectError async check func", done => {
    runVerify(
      expectError(() => {
        return new Promise((resolve, reject) => {
          runVerify(() => {
            return Promise.reject(new Error("test oops"));
          }, reject);
        });
      }),
      err => {
        expect(err.message).includes("test oops");
      },
      done
    );
  });

  it("should fail if expectError async check func didn't return error", done => {
    runVerify(
      expectError(next => {
        runVerify(
          expectError(() => {
            return Promise.resolve("oh well");
          }),
          next
        );
      }),
      err => {
        expect(err.message).includes("runVerify expecting error from check function number 0");
      },
      done
    );
  });

  it("should fail if expectError check func didn't return throw", done => {
    runVerify(
      expectError(next => {
        runVerify(
          expectError(() => {
            return "oh well";
          }),
          next
        );
      }),
      err => {
        expect(err.message).includes("runVerify expecting error from check function number 0");
      },
      done
    );
  });

  it("should detect callback from check func with single param's name", done => {
    runVerify(
      function(done2) {
        return fooEvent(1, done2);
      },
      data => {
        expect(data).to.equal("foo");
      },
      done
    );
  });

  it("should pass callback to withCallback check func", done => {
    runVerify(
      withCallback(x => {
        return fooEvent(1, x);
      }),
      data => {
        expect(data).to.equal("foo");
      },
      done
    );
  });

  it("should fail if no done function passed", done => {
    runVerify(
      expectError(() => {
        runVerify(() => {});
      }),
      err => {
        expect(err.message).includes("runVerify - must pass done function");
      },
      done
    );
  });

  it("should fail if pass in a non-function", done => {
    runVerify(
      expectError(next => {
        runVerify("woohoo", next);
      }),
      err => {
        expect(err.message).includes("runVerify param 0 is not a function: type string");
      },
      done
    );
  });

  it("should pass result to done if it's expecting them", done => {
    runVerify(
      callback => fooEvent(1, callback),
      (err, r) => {
        if (r !== "foo") {
          return done(new Error("expect result to be 'foo'"));
        }
        return done(err);
      }
    );
  });

  it("should call AsyncFunction without callback", done => {
    runVerify(
      next => fooEvent(1, next),
      async (a, b, c) => {
        expect(a).to.equal("foo");
        expect(b).to.equal(undefined);
        expect(c).to.equal(undefined);
      },
      done
    );
  });

  it("should call function with more than 1 param with callback", done => {
    runVerify(
      next => fooEvent(1, next),
      (result, next) => {
        expect(result).to.equal("foo");
        expect(typeof next).to.equal("function");
        next();
      },
      done
    );
  });
});

describe("wrapVerify", function() {
  it("should make a callback to run verify", done => {
    const wrapped = wrapVerify(r => expect(r).to.equal("hello"), done);
    wrapped("hello");
  });
});

describe("asyncVerify", function() {
  it("should return a promise to run verify", () => {
    return asyncVerify(
      next => fooEvent(1, next),
      data => {
        expect(data).to.equal("foo");
      }
    );
  });

  it("should handle check func returning error", () => {
    return asyncVerify(
      expectError(() => {
        return asyncVerify(
          next => fooEvent(1, next),
          data => {
            expect(data).to.equal("blah");
          }
        );
      })
    );
  });
});

describe("wrapAsyncVerify", function() {
  it("should make a callback to run asyncVerify", () => {
    const wrapped = wrapAsyncVerify(r => expect(r).to.equal("hello"));
    return wrapped("hello");
  });
});
