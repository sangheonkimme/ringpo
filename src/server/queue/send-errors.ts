/** Budget deferral has made no API request and must not consume a retry attempt. */
export class SendDeferredError extends Error {
  constructor(readonly nextAttemptAt: Date, readonly reason: string) { super("Send deferred by account budget"); this.name = "SendDeferredError"; }
}

/** A write may have been accepted. Never automatically send the same intent again. */
export class SendUncertainError extends Error {
  constructor(readonly code: string) { super("Send outcome requires review"); this.name = "SendUncertainError"; }
}

export class SendRejectedError extends Error {
  constructor(readonly code: string) { super("Send definitively rejected"); this.name = "SendRejectedError"; }
}
