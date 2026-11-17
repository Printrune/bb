import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

export function MatchInvite({ roomId, inviteUrl }: { roomId: string; inviteUrl: string }) {
  const code = useRef<HTMLInputElement>(null);
  const link = useRef<HTMLInputElement>(null);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => () => { if (reset.current) clearTimeout(reset.current); }, []);

  async function copy(kind: 'code' | 'link') {
    if (reset.current) clearTimeout(reset.current);
    setCopied(null); setMessage('');
    try {
      await navigator.clipboard.writeText(kind === 'code' ? roomId : inviteUrl);
      setCopied(kind);
      setMessage(kind === 'code' ? 'Room code copied.' : 'Invitation link copied.');
      reset.current = setTimeout(() => { setCopied(null); setMessage(''); }, 2500);
    } catch {
      const field = kind === 'code' ? code.current : link.current;
      field?.focus(); field?.select();
      setMessage(`Select and copy the ${kind === 'code' ? 'code' : 'link'} above.`);
    }
  }

  return <section className="match-invite" aria-label="Match invitation">
    <label className="room-code-label" htmlFor="created-room-code">ROOM CODE</label>
    <input ref={code} id="created-room-code" className="room-code-value" value={roomId} readOnly
      spellCheck={false} autoCapitalize="none" onFocus={(event) => event.currentTarget.select()} />
    <div className="invite-actions">
      <button className="button button-primary" onClick={() => void copy('code')}><Icon name={copied === 'code' ? 'check' : 'copy'} />{copied === 'code' ? 'CODE COPIED' : 'COPY CODE'}</button>
      <button className="button button-secondary" onClick={() => void copy('link')}><Icon name={copied === 'link' ? 'check' : 'link'} />{copied === 'link' ? 'LINK COPIED' : 'COPY LINK'}</button>
    </div>
    <input ref={link} className="invite-link" value={inviteUrl} readOnly aria-label="Invitation link"
      onFocus={(event) => event.currentTarget.select()} />
    <span className="invite-feedback" role="status">{message}</span>
  </section>;
}
