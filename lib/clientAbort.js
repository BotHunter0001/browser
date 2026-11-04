function wireClientAbort(req, res, controller) {
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  const onFinish = () => {
    cleanup();
    abort();
  };
  const onClose = () => {
    cleanup();
    if (!res.writableFinished) abort();
  };
  const cleanup = () => {
    req.off('aborted', abort);
    res.off('finish', onFinish);
    res.off('close', onClose);
  };

  if (req.aborted) {
    abort();
    return;
  }

  req.once('aborted', abort);
  res.once('finish', onFinish);
  res.once('close', onClose);
}

module.exports = { wireClientAbort };
