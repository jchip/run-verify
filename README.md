# run-verify

Proper test verifications

```bash
$ npm install --save-dev run-verify
```

# Table of Content

- [`expect` Test Verifications](#expect-test-verifications)
  - [Verifying Events and `callbacks` without Promise](#verifying-events-and-callbacks-without-promise)
  - [Verifying with Promisification](#verifying-with-promisification)
  - [Verifying with run-verify](#verifying-with-run-verify)
    - [Using `runVerify` with `done`](#using-runverify-with-done)
    - [Using Promisified `asyncVerify`](#using-promisified-asyncverify)
  - [Verifying Expected Failures](#verifying-expected-failures)
    - [Verifying Failures with callbacks](#verifying-failures-with-callbacks)
    - [Verifying Failures with Promise](#verifying-failures-with-promise)
    - [Verifying Failures with `run-verify`](#verifying-failures-with-run-verify)
- [`checkFunc`](#checkfunc)
  - [0 Parameter](#0-parameter)
  - [1 Parameter](#1-parameter)
  - [2 Parameters](#2-parameters)
- [APIs](#apis)
  - [`runVerify`](#runverify)
  - [`asyncVerify`](#asyncverify)
  - [`wrapCheck`](#wrapcheck)
  - [`expectError`](#expecterror)
  - [`withCallback`](#withcallback)
  - [`wrapVerify`](#wrapverify)
  - [`wrapAsyncVerify`](#wrapasyncverify)
- [License](#license)

# `expect` Test Verifications

### Verifying Events and `callbacks` without Promise

For test runner that doesn't have built-in `expect` utility, if not all code/libraries you use are promisified, then `expect` in a test that involves async events doesn't work well.

For example, the `expect` failure below would be out of band as an [UncaughtException] and the test runner can't catch and report it normally:

```js
it("should emit an event", done => {
  foo.on("event", data => {
    expect(data).to.equal("expected value");
    done();
  });
});
```

> test runners generally watch for uncaught errors, but it doesn't always work well and the stack trace may be all confusing.

See below for discussions on some common patterns for writing tests that need to verify results from async events and callbacks, and how run-verify helps with them.

The first and obvious solution is you need to enclose verifications in `try/catch`:

```js
it("should emit an event", done => {
  foo.on("event", data => {
    try {
      expect(data).to.equal("expected value");
      done();
    } catch (err) {
      done(err);
    }
  });
});
```

However, it gets very messy like callback hell when a test deals with multiple async events.

Even with a test runner that takes a Promise as a return result, the same thing must be done:

```js
it("should emit an event", () => {
  return new Promise((resolve, reject) => {
    foo.on("event", data => {
      try {
        expect(data).to.equal("expected value");
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
});
```

### Verifying with Promisification

The test verification can be written nicely with promisification like:

```js
const promisifiedFooEvent() => new Promise(resolve => foo.on("event", resolve));
```

So the verification is now like this:

```js
it("should emit an event", (done) => {
  return promisifiedFooEvent().then(data => {
    expect(data).to.equal("expected value");
  }).then(done).catch(done);
});
```

The `.then(done).catch(done)` can be avoided if the test runner takes a Promise as return result:

```js
it("should emit an event", () => {
  return promisifiedFooEvent().then(data => {
    expect(data).to.equal("expected value");
  });
});
```

It's even nicer if `async/await` is supported:

```js
it("should emit an event", async () => {
  const data = await promisifiedFooEvent();
  expect(data).to.equal("expected value");
});
```

### Verifying with run-verify

But if you prefer not to wrap with promisification or facing a complex scenario, **run-verify** always allows you to write test verification nicely:

#### Using `runVerify` with `done`

Using `runVerify` if you are using the `done` callback from the test runner:

```js
const { runVerify } = require("run-verify");

it("should emit an event", done => {
  runVerify(
    next => foo.on("event", next),
    data => expect(data).to.equal("expected value"),
    done
  );
});
```

#### Using Promisified `asyncVerify`

Using `asyncVerify` if you are returning a Promise to the test runner:

```js
const { asyncVerify } = require("run-verify");

it("should emit an event", () => {
  return asyncVerify(
    next => foo.on("event", next),
    data => expect(data).to.equal("expected value")
  );
});
```

## Verifying Expected Failures

When you need to verify that a function actually throws an error, you can do:

```js
it("should throw", () => {
  expect(() => foo("bad input")).to.throw("bad input passed");
});
```

However, this gets a bit trickier for async functions which can invoke callback or reject with an error.

See below for some common patterns on how to verify async functions return errors and how **run-verify** helps.

### Verifying Failures with callbacks

```js
it("should invoke callback with error", done => {
  foo("bad input", err => {
    if (err) {
      try {
        expect(err.message).includes("bad input passed");
        done();
      } catch (err2) {
        done(err2);
      }
    }
  });
});
```

### Verifying Failures with Promise

For promise it is tricky, but the pattern I commonly use is to have a `.catch` that saves the expect error and then verify it in a `.then`:

```js
it("should reject", () => {
  let error;
  return promisifiedFoo("bad input")
    .catch(err => {
      error = err;
    })
    .then(() => {
      expect(error).to.exist;
      expect(error.message).includes("bad input passed");
    });
});
```

With `async/await`, it can be done very nicely using `try/catch`:

```js
it("should reject", async () => {
  try {
    await promisifiedFoo("bad input");
    throw new Error("expected rejection");
  } catch (err) {
    expect(err.message).includes("bad input passed");
  }
});
```

### Verifying Failures with `run-verify`

`run-verify` has an [`expectError`](#expecterror) decorator to mark a `checkFunc` is expecting to return or throw an error:

Example that uses a `done` callback from the test runner:

```js
const { expectError, runVerify } = require("run-verify");

it("should invoke callback with error", done => {
  runVerify(
    expectError(next => foo("bad input", next)),
    err => expect(err.message).includes("bad input passed"),
    done
  );
});
```

Example that returns a Promise to the test runner:

```js
const { expectError, asyncVerify } = require("run-verify");

it("should invoke callback with error", () => {
  return asyncVerify(
    expectError(next => foo("bad input", next)),
    err => expect(err.message).includes("bad input passed")
  );
});
```

Example when everything is promisified:

```js
const { expectError, asyncVerify } = require("run-verify");

it("should invoke callback with error", () => {
  return asyncVerify(
    expectError(() => promisifiedFoo("bad input")),
    err => expect(err.message).includes("bad input passed")
  );
});
```

# `checkFunc`

`runVerify` takes a list of functions as `checkFunc` to be invoked serially to run the test verification.

Each `checkFunc` can take 0, 1, or 2 parameters.

### 0 Parameter

```js
() => {}
```

- Assume to be a sync function
- But if it's intended to be async, then it should return a Promise
  - The Promise's resolved value is passed to next `checkFunc`.

### 1 Parameter

```js
(next|result) => {}
```

With only 1 parameter, it gets ambiguous whether it wants a `next` callback or a sync/Promise function taking a result.

`runVerify` does the following to disambiguate the `checkFunc`'s single parameter:

- It's expected to be the `next` callback if:
  -  the parameter name starts with one of the following:
     - `next`, `cb`, `callback`, or `done`
     - The name check is case insensitive
  - The function is decorated with the [withCallback](#withcallback) decorator
- Otherwise it's expected to take the result from previous `checkFunc`
  - And its behavior is treated the same as the [0 parameter checkFunc](#0-parameter)
- A native `AsyncFunction` is always expected to take the result and returns a Promise.

ie:

```js
async (result) => {}
```

### 2 Parameters

```js
(result, next) => {}
```

This is always treated as an async function taking the `result` and a `next` callback:

- `result` - result from previous `checkFunc`
- `next` - callback to invoke the next `checkFunc`

# APIs

## `runVerify`

```js
runVerify(...checkFuncs, done)
```

The main API, params:

| name         | description                                                         |
| ------------ | ------------------------------------------------------------------- |
| `checkFuncs` | variadic list of functions to invoke to run tests and verifications |
| `done`       | `done(err, result)` callback after verification is done or failed   |

- See details about [checkFunc](#checkfunc).

Each `checkFunc` is invoked serially, with the result from one passed to the next, depending on its parameters.

`done` is invoked at the end, but if any `checkFunc` fails, then `done` is invoked immediately with the error.

## `asyncVerify`

```js
asyncVerify(...checkFuncs)
```

The promisified version of [runVerify](#runverify).  Returns a Promise.

## `wrapCheck`

```js
wrapCheck(checkFunc)
```

Wrap a `checkFunc` with the `expectError` and `withCallback` decorators.

For example:

```js
runVerify(
  wrapCheck((next) => foo("bad input", next)).expectError.withCallback,
  done
)
```

## `expectError`

```js
expectError(checkFunc)
```

Shortcut for:

```js
wrapCheck(checkFunc).expectError
```

Decorate a `checkFunc` to be expected to throw or return `Error`.  Its error will be passed to the next `checkFunc`.

This uses [wrapCheck](#wrapcheck) internally so [withCallback](#withcallback) is also available after:

```js
expectError(() => {}).withCallback
```

## `withCallback`

```js
withCallback(checkFunc)
```

Shortcut for:

```js
wrapCheck(checkFunc).withCallback
```

Decorate a `checkFunc` that takes a single parameter to expect a `next` callback for that parameter.

This uses [wrapCheck](#wrapcheck) internally so [expectError](#expecterror) is also available after:

```js
withCallback(() => {}).expectError
```

## `wrapVerify`

```js
wrapVerify(...checkFuncs, done)
```

Returns a function that wraps [`runVerify`](#runverify) and takes a single parameter, which is passed to the first `checkFunc` as result.

## `wrapAsyncVerify`

```js
wrapAsyncVerify(...checkFuncs)
```

The promisified version of [`wrapVerify`](#wrapverify)

# License

Licensed under the [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0)

---

[uncaughtexception]: https://nodejs.org/api/process.html#process_event_uncaughtexception
