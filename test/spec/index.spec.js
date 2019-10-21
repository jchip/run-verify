"use strict";

const {
  runVerify,
  wrapVerify,
  asyncVerify,
  wrapAsyncVerify,
  expectError,
  expectErrorHas,
  expectErrorToBe,
  onFailVerify,
  withCallback,
  wrapCheck,
  runTimeout,
  runFinally,
  runDefer
} = require("../..");

const { IS_FINALLY } = require("../../lib/symbols");

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

  it("should catch errors from sync finally checkFunc", done => {
    let f1;
    let f2;
    runVerify(
      runFinally(() => {
        return Promise.reject(new Error("test"));
      }),
      runFinally(() => {
        f1 = true;
        throw new Error("test 1");
      }),
      () => "hello",
      runFinally(() => (f2 = true)),
      r => {
        expect(r).to.equal("hello");
        return r;
      },
      err => {
        try {
          expect(f1).equal(true);
          expect(f2).equal(undefined);
          expect(err).to.exist;
          expect(err.message).to.equal("test 1");
          done();
        } catch (err2) {
          done(err2);
        }
      }
    );
  });

  it("should catch errors from async finally checkFunc", done => {
    let f1;
    let f2;
    runVerify(
      runFinally(() => (f1 = true)),
      () => "hello",
      runFinally(() => {
        return Promise.reject(new Error("test"));
      }),
      r => {
        expect(r).to.equal("hello");
        return r;
      },
      runFinally(() => {
        f2 = true;
      }),
      err => {
        try {
          expect(f1).equal(true);
          expect(f2).equal(true);
          expect(err).to.exist;
          done();
        } catch (err2) {
          done(err2);
        }
      }
    );
  });

  it("should timeout on a stuck test", done => {
    let f1;
    let f2;
    runVerify(
      runFinally(() => (f1 = true)),
      () => "hello",
      runFinally(() => {
        return Promise.reject(new Error("test"));
      }),
      runTimeout(50),
      r => {
        expect(r).to.equal("hello");
        return r;
      },
      runFinally(() => {
        f2 = true;
      }),
      runTimeout(100),
      next => setTimeout(next, 1000),
      err => {
        try {
          expect(f1).equal(true);
          expect(f2).equal(true);
          expect(err).to.exist;
          expect(err.message).equal("runVerify: test timeout after 100ms");
          done();
        } catch (err2) {
          done(err2);
        }
      }
    );
  });
});

describe("runDefer", function() {
  it("should allow user to use defer to resolve test", () => {
    const defer = runDefer();
    return asyncVerify(
      defer,
      runTimeout(20),
      () => {
        defer.resolve("hello");
      },
      defer.wait(),
      r => {
        expect(r).equal("hello");
      }
    );
  });

  it("should allow user clear defer status", () => {
    const defer = runDefer();
    return asyncVerify(
      defer,
      () => {
        defer.resolve("hello");
      },
      defer.wait(20),
      r => {
        expect(r).equal("hello");
      },
      () => {
        setTimeout(() => {
          defer.resolve("second");
        }, 20);
      },
      defer.clear(),
      defer.wait(50),
      r => {
        expect(r).equal("second");
      }
    );
  });

  it("should allow user to use defer to async resolve test", () => {
    const defer = runDefer();
    return asyncVerify(
      () =>
        asyncVerify(defer, runTimeout(20), () => {
          setTimeout(() => defer.resolve("hello"), 10);
        }),
      r => {
        expect(r).equal("hello");
      }
    );
  });

  it("should time out and ignore late resolve", () => {
    const defer = runDefer();
    const defer2 = runDefer(10);

    defer2.event.once("resolve", r => {
      defer.resolve(r);
    });

    return asyncVerify(
      defer,
      expectError(() =>
        asyncVerify(defer2, () => {
          setTimeout(() => {
            defer2.resolve("hello");
          }, 20);
        })
      ),
      r => {
        expect(r).to.exist;
        expect(r).to.be.an("Error");
        expect(r.message).equal("runDefer timed out after 10ms");
      },
      defer.onResolve(r => {
        expect(r).equal("hello");
      })
    );
  });

  it("should time out on wait and ignore late resolve", () => {
    const defer = runDefer();
    const defer2 = runDefer();

    defer2.event.once("resolve", r => {
      defer.resolve(r);
    });

    return asyncVerify(
      defer,
      expectError(() =>
        asyncVerify(
          defer2,
          () => {
            setTimeout(() => {
              defer2.resolve("hello");
            }, 20);
          },
          defer2.wait(10)
        )
      ),
      r => {
        expect(r).to.exist;
        expect(r).to.be.an("Error");
        expect(r.message).equal("defer wait timeout after 10ms");
      },
      defer.onResolve(r => {
        expect(r).equal("hello");
      })
    );
  });

  it("should allow user to use defer to reject test", () => {
    const defer = runDefer();
    let reachedBad;
    return asyncVerify(
      expectError(() =>
        asyncVerify(
          defer,
          runTimeout(20),
          () => {
            defer.reject(new Error("test defer reject"));
          },
          () => {
            reachedBad = new Error("not expecting to reach here");
          }
        )
      ),
      r => {
        expect(r).to.exist;
        expect(r).to.be.an("Error");
        expect(r.message).equal("test defer reject");
        if (reachedBad) {
          throw reachedBad;
        }
      }
    );
  });

  it("should fail if onResolve throws", () => {
    const defer = runDefer();
    return asyncVerify(
      expectError(() =>
        asyncVerify(
          defer,
          runTimeout(20),
          () => {
            defer.resolve("hello");
          },
          defer.onResolve(() => {
            throw new Error("fail resolve");
          })
        )
      ),
      r => {
        expect(r).to.exist;
        expect(r).to.be.an("Error");
        expect(r.message).equal("fail resolve");
      }
    );
  });

  it("should invoke onReject handlers", () => {
    const defer = runDefer();
    return asyncVerify(
      expectError(() =>
        asyncVerify(
          defer,
          runTimeout(20),
          () => {
            defer.reject("hello");
          },
          defer.onReject(() => {
            throw new Error("onReject error");
          })
        )
      ),
      r => {
        expect(r).to.exist;
        expect(r).to.be.an("Error");
        expect(r.message).equal("onReject error");
      }
    );
  });

  it("should handle multiple runDefer", () => {
    const defer1 = runDefer();
    const defer2 = runDefer();
    return asyncVerify(
      defer1,
      defer2,
      () => {
        setTimeout(() => {
          defer1.resolve("done1");
        }, 10);
      },
      () => {
        setTimeout(() => {
          defer2.resolve("done2");
        });
      }
    );
  });

  it("should wait for defer resolve", () => {
    const defer1 = runDefer();
    const defer2 = runDefer();
    return asyncVerify(
      defer1,
      defer2,
      () => {
        setTimeout(() => {
          defer1.resolve("done1");
        }, 10);
      },
      () => {
        setTimeout(() => {
          defer2.resolve("done2");
        });
      },
      defer1.wait(),
      r => {
        expect(r).equal("done1");
      },
      defer2.wait(),
      r => {
        expect(r).equal("done2");
      }
    );
  });

  it("should wait for defer reject", () => {
    const defer1 = runDefer();
    // const defer2 = runDefer();
    return asyncVerify(
      expectError(() => {
        return asyncVerify(
          defer1,
          // defer2,
          () => {
            setTimeout(() => {
              defer1.reject(new Error("fail1"));
            }, 10);
          },
          defer1.wait()
        );
      }),
      r => {
        expect(r).to.be.an("Error");
        expect(r.message).equal("fail1");
      }
    );
  });

  it("should failed on already waited and resolved defer", () => {
    const defer1 = runDefer();
    const defer2 = runDefer();
    return asyncVerify(
      defer1,
      defer2,
      () => {
        defer1.resolve("done1");
      },
      () => {
        setTimeout(() => {
          defer2.resolve("done2");
        }, 50);
      },
      defer1.wait(),
      r => {
        expect(r).equal("done1");
      },
      defer2.wait(),
      r => {
        expect(r).equal("done2");
      },
      expectError(defer1.wait()),
      r => {
        expect(r).to.be.an("Error");
        expect(r.message).contains("defer already waited");
        defer1.clear();
        defer1.resolve("done1");
      },
      defer1.wait(),
      r => {
        expect(r).equal("done1");
      },
      // should allow wait again with true flag
      defer2.waitAgain(),
      r => {
        expect(r).equal("done2");
      }
    );
  });

  it("should failed on already waited and rejected defer", () => {
    const defer1 = runDefer();
    const defer2 = runDefer();
    return asyncVerify(
      defer1,
      defer2,
      () => {
        defer1.reject(new Error("fail1"));
      },
      () => {
        setTimeout(() => {
          defer2.reject(new Error("fail2"));
        }, 50);
      },
      expectError(defer1.wait()),
      r => {
        expect(r).to.be.an("Error");
        expect(r.message).equal("fail1");
      },
      expectError(defer2.wait()),
      r => {
        expect(r).to.be.an("Error");
        expect(r.message).equal("fail2");
      },
      expectError(defer1.wait()),
      r => {
        expect(r).to.be.an("Error");
        expect(r.message).contains("defer already waited");
      },
      expectError(defer2.wait()),
      r => {
        expect(r).to.be.an("Error");
        expect(r.message).contains("defer already waited");
      }
    );
  });

  it("should fail if one of multiple defers failed", () => {
    const defer1 = runDefer();
    const defer2 = runDefer();
    const defer3 = runDefer();
    return asyncVerify(
      expectError(() =>
        asyncVerify(
          defer1,
          defer3,
          () => {
            setTimeout(() => {
              defer1.resolve("done1");
            }, 10);
          },
          defer2,
          () => {
            setTimeout(() => {
              defer2.reject(new Error("fail2"));
            }, 50);
          },
          () => {
            setTimeout(() => {
              defer3.reject(new Error("fail3"));
            }, 20);
          }
        )
      ),
      r => {
        expect(r).to.exist;
        expect(r).to.be.an("Error");
        expect(r.message).equal("fail3");
      }
    );
  });
});

describe("runFinally", function() {
  it("should make a callback that's always run", () => {
    const x = runFinally(() => {});
    expect(x[IS_FINALLY]).equal(true);
  });

  it("should make callbacks that's invoked regardless of test result", done => {
    let f1;
    let f2;
    let f3;
    let t4;
    runVerify(
      runFinally(() => (f1 = true)),
      () => "hello",
      runFinally(() => (f2 = true)),
      r => {
        expect(r).to.equal("hello");
        return r;
      },
      () => {
        throw new Error("oops");
      },
      runFinally(() => (f3 = true)),
      () => (t4 = true),
      err => {
        try {
          expect(err).to.exist;
          expect(err.message).equal("oops");
          expect(f1).equal(true);
          expect(f2).equal(true);
          expect(f3).equal(true);
          expect(t4).equal(undefined);
          done();
        } catch (err2) {
          done(err2);
        }
      }
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

  it("should catch errors from async finally checkFun", () => {
    let f1;
    let f2;
    let error;
    return asyncVerify(
      runFinally(() => (f1 = true)),
      () => "hello",
      runFinally(() => {
        return Promise.reject(new Error("test"));
      }),
      r => {
        expect(r).to.equal("hello");
        return r;
      },
      runFinally(() => {
        f2 = true;
      })
    )
      .catch(err => (error = err))
      .then(() => {
        expect(error).to.exist;
        expect(f1).equal(true);
        expect(f2).equal(true);
      });
  });

  it("should invoke onFailVerify callback", () => {
    let catchError;
    const oops = "oops - test failure";
    const test1 = () =>
      asyncVerify(
        () => {
          throw new Error(oops);
        },
        onFailVerify(err => {
          catchError = err;
        }),
        () => {
          throw new Error("bad - not expecting this to be called");
        }
      );

    return asyncVerify(expectErrorToBe(test1, oops), () => {
      expect(catchError.message).equals(oops);
    });
  });

  it("should use exception from onFailVerify callback as new error", () => {
    let catchError;
    const oops = "oops - test failure";
    const test1 = () =>
      asyncVerify(
        () => {
          throw new Error("first oops");
        },
        onFailVerify(err => {
          catchError = err;
          throw new Error(oops);
        }),
        () => {
          throw new Error("bad - not expecting this to be called");
        }
      );

    return asyncVerify(expectErrorToBe(test1, oops), err => {
      expect(err.message).equals(oops);
      expect(catchError.message).equals("first oops");
    });
  });

  it("should skip onFailVerify callback", () => {
    let catchError;
    let count = 0;
    const test1 = () =>
      asyncVerify(
        () => count++,
        onFailVerify(err => {
          catchError = err;
          count++;
        }),
        () => count++
      );

    return asyncVerify(test1, () => {
      expect(count, "should go through all checks and skip onFailVerify").equal(2);
      expect(catchError).to.be.undefined;
    });
  });
});

describe("wrapAsyncVerify", function() {
  it("should make a callback to run asyncVerify", () => {
    const wrapped = wrapAsyncVerify(r => expect(r).to.equal("hello"));
    return wrapped("hello");
  });
});
