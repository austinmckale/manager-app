export const OWNER_NOTIFY_EMAIL = "austinmck17@gmail.com";
export const OWNER_NOTIFY_PHONE = "6104514099";

export function ownerEmailRecipients() {
  return [OWNER_NOTIFY_EMAIL];
}

export function ownerSendDecision(sendingEnabled: boolean) {
  return {
    discord: "allowed",
    email: sendingEnabled ? "chosen" : "off",
    sms: "off" as const,
    to: ownerEmailRecipients(),
    phone: OWNER_NOTIFY_PHONE,
  };
}
