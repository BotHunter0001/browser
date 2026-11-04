const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { wireClientAbort } = require('./clientAbort');

function createRequestResponse() {
  const req = new EventEmitter();
  req.aborted = false;
  const res = new EventEmitter();
  res.writableFinished = false;
  return { req, res, controller: new AbortController() };
}

test('normal request close does not cancel an upstream stream', () => {
  const { req, res, controller } = createRequestResponse();
  wireClientAbort(req, res, controller);

  req.emit('close');

  assert.equal(controller.signal.aborted, false);
});

test('aborted request cancels the upstream stream', () => {
  const { req, res, controller } = createRequestResponse();
  wireClientAbort(req, res, controller);

  req.emit('aborted');

  assert.equal(controller.signal.aborted, true);
});

test('response close cancels only when the client disconnects before completion', () => {
  const { req, res, controller } = createRequestResponse();
  wireClientAbort(req, res, controller);

  res.emit('close');

  assert.equal(controller.signal.aborted, true);
});

test('finished response aborts upstream work after successful completion', () => {
  const { req, res, controller } = createRequestResponse();
  wireClientAbort(req, res, controller);
  res.writableFinished = true;

  res.emit('finish');

  assert.equal(controller.signal.aborted, true);
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
});
