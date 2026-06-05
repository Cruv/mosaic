import { useEffect, useRef, useState } from 'react';
import { useChat, useMosaic } from './context';

const EMOJIS = ['🔥', '😂', '😮', '😢', '👏', '❤️', '🎉', '💯'];

/** Real-time chat plus an emoji reaction bar. Reactions broadcast to everyone
 *  and float over the program view. */
export function Chat() {
  const { connection } = useMosaic();
  const msgs = useChat();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    connection.sendChat(t);
    setText('');
  };

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef}>
        {msgs.length === 0 && <div className="chat-hint">No messages yet — say hi 👋</div>}
        {msgs.map((m, i) => (
          <div key={i} className="chat-msg">
            <span className="chat-name">{m.name}</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="chat-reactions">
        {EMOJIS.map((e) => (
          <button key={e} className="react-btn" onClick={() => connection.sendReaction(e)} title="React">
            {e}
          </button>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={text}
          maxLength={500}
          placeholder="Say something…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button className="btn btn-primary btn-sm" onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}
