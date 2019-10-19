"use strict";

const WRAPPED_FN = Symbol("wrapped fn");
const IS_FINALLY = Symbol("isFinally");
const DEFER_EVENT = Symbol("defer_event");
const DEFER_WAIT = Symbol("defer_wait");
const DEFER_OBJ = Symbol("defer_obj");

module.exports = {
  WRAPPED_FN,
  IS_FINALLY,
  DEFER_EVENT,
  DEFER_WAIT,
  DEFER_OBJ
};
