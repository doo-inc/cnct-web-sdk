/**
 * The same interface as `examples/browser`, as a React component.
 *
 * `useSyncExternalStore` is the right hook for this and not a flourish: `chat.state` is replaced rather
 * than mutated, so the store contract — subscribe, read a snapshot — is exactly what this SDK already
 * offers, and React gets tearing-free reads without a `useEffect` that copies state into state.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Cnct } from 'cnct-web-sdk';

export function Chat({ host, publicKey, displayName = 'Someone' }) {
  const chat = useMemo(() => new Cnct({ baseUrl: host }).chat(publicKey), [host, publicKey]);

  const state = useSyncExternalStore(
    useCallback((onChange) => chat.on('change', onChange), [chat]),
    useCallback(() => chat.state, [chat]),
    useCallback(() => chat.state, [chat]), // the server snapshot: `idle`, with nothing in it
  );

  useEffect(() => {
    chat.boot().catch(() => {});
    chat.resume().catch(() => {});
    // Disconnect on unmount, or a route change leaves a socket and a reconnect timer behind.
    return () => chat.disconnect();
  }, [chat]);

  const input = useRef(null);

  async function onSubmit(event) {
    event.preventDefault();
    const body = input.current.value.trim();
    if (!body) return;
    input.current.value = '';
    if (!chat.hasSession) await chat.start({ displayName });
    // The failure is already on `state.error` and the bubble is already marked.
    chat.send(body).catch(() => {});
  }

  if (state.inbox && !state.inbox.isActive)
    return <p>{state.inbox.business} is not taking messages.</p>;

  return (
    <div className="chat">
      <header>
        <b>{state.inbox?.business ?? '…'}</b>
        <small>{state.conversation?.withPerson ? 'someone is here' : state.status}</small>
      </header>

      <ol className="log">
        {state.messages.map((message) => (
          <Message
            key={message.id}
            message={message}
            onRetry={() => chat.retry(message.clientKey).catch(() => {})}
          />
        ))}
      </ol>

      {state.theyAreTyping && <p className="typing">typing…</p>}
      {state.error && <p className="error">{state.error.message}</p>}

      <form onSubmit={onSubmit}>
        <input ref={input} onChange={() => chat.typing()} placeholder="Write a message" />
        <button type="submit" disabled={state.status !== 'idle' && !chat.canSend}>
          Send
        </button>
      </form>
    </div>
  );
}

function Message({ message, onRetry }) {
  // Anything this component has no case for renders as its own body, which always reads correctly —
  // including card types added to the platform after this file was written.
  switch (message.type) {
    case 'TICKET_UPDATE':
      return (
        <li className="card">
          <b>Ticket #{message.data.ticketNumber}</b>
          {message.body}
        </li>
      );
    case 'BOOKING_UPDATE':
      return (
        <li className="card">
          <b>{new Date(message.data.startsAt).toLocaleString()}</b>
          {message.body}
          {message.data.locationName && <small>{message.data.locationName}</small>}
        </li>
      );
    default:
      return (
        <li
          className={`bubble ${message.speaker}`}
          data-pending={message.pending}
          data-failed={message.failed}
        >
          {message.body}
          {message.failed && (
            <button type="button" onClick={onRetry}>
              Not sent — try again
            </button>
          )}
        </li>
      );
  }
}
