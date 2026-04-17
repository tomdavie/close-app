import React, { useState } from 'react';

function inviteUrlForBuilding(buildingId) {
  if (typeof window === 'undefined' || !buildingId) return '';
  return `${window.location.origin}/join/${buildingId}`;
}

function buildingDetailsLine(building) {
  if (!building) return '';
  const addr = (building.address || '').trim();
  const pc = (building.postcode || '').trim();
  if (addr && pc) return `${addr}, ${pc}`;
  return addr || pc || (building.name || '').trim() || '';
}

function whatsappInviteBody(buildingId, building) {
  const inviteUrl = inviteUrlForBuilding(buildingId);
  const buildingDetails = buildingDetailsLine(building);
  if (!buildingId || !inviteUrl || !buildingDetails) return '';
  return `I'd like us to get rid of our factor and manage ${buildingDetails} ourselves using Clōse. Lower costs, better service, and we're in control.

Join here so we can have a say, vote on repairs, and manage the fund together:
${inviteUrl}

Takes 2 minutes to set up.`;
}

function InviteShare({ buildingId, building }) {
  const [copied, setCopied] = useState(null);
  const inviteUrl = inviteUrlForBuilding(buildingId);
  const whatsappText = whatsappInviteBody(buildingId, building);

  function copyText(key, text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  if (!buildingId) {
    return (
      <main className="home invite-share">
        <p className="auth-loading-text">No building selected.</p>
      </main>
    );
  }

  return (
    <main className="home invite-share">
      <section className="home-section">
        <div className="slabel">Invite neighbours</div>
        <div className="card fund-add-card invite-share-card">
          <p className="onboard-card-hint invite-share-lede">
            Share your building link or drop the message into WhatsApp — same as when you first set up Clōse.
          </p>

          <label className="auth-label" htmlFor="invite-url-field">
            Invite link
          </label>
          <div className="onboard-copy-row">
            <input
              id="invite-url-field"
              readOnly
              aria-readonly="true"
              autoComplete="off"
              spellCheck={false}
              className="auth-input onboard-readonly"
              value={inviteUrl}
            />
            <button type="button" className="onboard-copy-btn" onClick={() => copyText('link', inviteUrl)}>
              {copied === 'link' ? 'Copied!' : 'Copy link'}
            </button>
          </div>

          <label className="auth-label invite-share-wa-label" htmlFor="invite-wa-preview">
            WhatsApp message
          </label>
          <div id="invite-wa-preview" className="onboard-wa-block" aria-live="polite">
            {whatsappText ? (
              whatsappText.split(/\n\n+/).map((block, i) => (
                <p key={i} className="onboard-wa-para">
                  {block}
                </p>
              ))
            ) : (
              <p className="onboard-wa-para">
                Add your building address in Settings to generate the full invite message.
              </p>
            )}
          </div>
          <button
            type="button"
            className="onboard-copy-wide"
            disabled={!whatsappText}
            onClick={() => copyText('wa', whatsappText)}
          >
            {copied === 'wa' ? 'Copied to clipboard' : 'Copy message'}
          </button>
        </div>
      </section>
    </main>
  );
}

export default InviteShare;
