/**
 * One-tap ways to answer a lead from its card. Texts and emails open on Ryan's phone with a
 * first message already written in his voice, so they go out from his own number and inbox.
 */

const WAIT_ALERT_MINUTES = 120;

type LeadLike = {
  contactName: string;
  phone?: string | null;
  email?: string | null;
  serviceType?: string | null;
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

const projectPhrase = (service?: string | null) => {
  const value = (service ?? "").trim().toLowerCase();
  return value ? `your ${value} project` : "your project";
};

export function leadTextMessage(lead: LeadLike) {
  return `Hi ${firstName(lead.contactName)}, this is Ryan with RHI Pros. Thanks for reaching out about ${projectPhrase(lead.serviceType)}. When's a good time to talk?`;
}

export function leadEmailDraft(lead: LeadLike) {
  const subject = `${projectPhrase(lead.serviceType).replace(/^your/, "Your")} – RHI Pros`;
  const body = [
    `Hi ${firstName(lead.contactName)},`,
    "",
    `Thanks for reaching out about ${projectPhrase(lead.serviceType)}. I'd like to hear a little more about what you have in mind and set up a time to see the space.`,
    "",
    "What's the best number and time to reach you?",
    "",
    "Thanks,",
    "Ryan",
    "RHI Pros · (484) 706-9229",
  ].join("\n");
  return { subject, body };
}

const phoneDigits = (phone?: string | null) => (phone ?? "").replace(/[^\d+]/g, "");

export function leadContactLinks(lead: LeadLike) {
  const digits = phoneDigits(lead.phone);
  const email = (lead.email ?? "").trim();
  const draft = leadEmailDraft(lead);
  return {
    call: digits ? `tel:${digits}` : null,
    // "?&body=" works on both iPhone and Android.
    text: digits ? `sms:${digits}?&body=${encodeURIComponent(leadTextMessage(lead))}` : null,
    email: email
      ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`
      : null,
  };
}

/** How long a NEW lead has been waiting, once it is past the two-hour callback promise. */
export function leadWaitAlert(createdAt: Date, now = new Date()) {
  const minutes = Math.floor((now.getTime() - createdAt.getTime()) / 60_000);
  if (minutes < WAIT_ALERT_MINUTES) return null;
  if (minutes < 60 * 24) return `Waiting ${Math.floor(minutes / 60)}h`;
  const days = Math.floor(minutes / (60 * 24));
  return `Waiting ${days} day${days === 1 ? "" : "s"}`;
}
