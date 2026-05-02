import { Resend } from 'resend';
import { logger } from './lib/logger.js';

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  return new Resend(apiKey);
}

const FROM = process.env.RESEND_FROM_EMAIL ?? 'Content Rocket <onboarding@resend.dev>';
const APP_URL = process.env.REPLIT_DOMAINS
  ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`
  : 'https://contentrocket.app';

function baseTemplate(bodyContent: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Content Rocket</title>
</head>
<body style="margin:0;padding:0;background-color:#080614;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#f8fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#080614;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:12px;">
                    <img src="${APP_URL}/logo.png" alt="Content Rocket" width="48" height="48"
                      style="border-radius:12px;display:block;" />
                  </td>
                  <td>
                    <p style="margin:0;font-size:10px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;color:#64748b;">TAW Media</p>
                    <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">Content Rocket</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#0d0920;border:1px solid #2a1e4a;border-radius:16px;padding:40px 36px;">
              ${bodyContent}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#475569;">
                TAW Media · Content Rocket Pro<br />
                <a href="${APP_URL}" style="color:#f21178;text-decoration:none;">contentrocket.app</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function pinkButton(href: string, label: string) {
  return `<table cellpadding="0" cellspacing="0" style="margin:0 auto;">
    <tr>
      <td style="background:linear-gradient(135deg,#f21178,#7c3aed);border-radius:10px;">
        <a href="${href}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;">${label}</a>
      </td>
    </tr>
  </table>`;
}

function divider() {
  return `<hr style="border:none;border-top:1px solid #2a1e4a;margin:28px 0;" />`;
}

// ─── Email templates ──────────────────────────────────────────────────────────

export function subscriptionConfirmationHtml(planLabel: string) {
  const body = `
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#ffffff;line-height:1.2;">
      You're in! 🚀
    </h1>
    <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;line-height:1.6;">
      Your <strong style="color:#f8fafc;">${planLabel}</strong> subscription is now active.
      Everything is ready — start turning your videos into a full content pack today.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#16102a;border:1px solid #2a1e4a;border-radius:12px;padding:20px 24px;margin-bottom:28px;">
      <tr><td>
        <p style="margin:0 0 12px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;">What's included</p>
        ${[
          'YouTube Shorts scripts & captions',
          'Blog posts & long-form articles',
          'Email newsletters',
          'Social media carousels',
          'Podcast audio scripts',
          'Quote graphics & social threads',
        ].map(f => `
        <table cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
          <tr>
            <td style="padding-right:10px;vertical-align:middle;">
              <div style="width:6px;height:6px;border-radius:50%;background-color:#f21178;"></div>
            </td>
            <td style="font-size:14px;color:#cbd5e1;">${f}</td>
          </tr>
        </table>`).join('')}
      </td></tr>
    </table>

    ${pinkButton(`${APP_URL}/app`, 'Open Content Rocket')}

    ${divider()}
    <p style="margin:0;font-size:13px;color:#64748b;text-align:center;line-height:1.6;">
      Need help? Reply to this email or reach us at
      <a href="mailto:support@tawmedia.co" style="color:#f21178;text-decoration:none;">support@tawmedia.co</a>
    </p>
  `;
  return baseTemplate(body);
}

export function paymentFailedHtml() {
  const body = `
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#ffffff;line-height:1.2;">
      Payment failed
    </h1>
    <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;line-height:1.6;">
      We weren't able to process your most recent Content Rocket Pro payment.
      To keep your access, please update your billing details as soon as possible.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a0a0a;border:1px solid #7f1d1d;border-radius:12px;padding:18px 22px;margin-bottom:28px;">
      <tr><td>
        <p style="margin:0;font-size:14px;color:#fca5a5;line-height:1.5;">
          ⚠️ &nbsp;Your subscription will be paused if the payment isn't resolved. Update your card to avoid interruption.
        </p>
      </td></tr>
    </table>

    ${pinkButton(`${APP_URL}/app`, 'Update billing details')}

    ${divider()}
    <p style="margin:0;font-size:13px;color:#64748b;text-align:center;line-height:1.6;">
      Questions? Contact us at
      <a href="mailto:support@tawmedia.co" style="color:#f21178;text-decoration:none;">support@tawmedia.co</a>
    </p>
  `;
  return baseTemplate(body);
}

// ─── Send helpers ─────────────────────────────────────────────────────────────

export async function sendSubscriptionConfirmation(to: string, planLabel: string) {
  try {
    const resend = getResendClient();
    const { data, error } = await resend.emails.send({
      from: FROM,
      to,
      subject: `You're in — Welcome to Content Rocket Pro`,
      html: subscriptionConfirmationHtml(planLabel),
    });
    if (error) {
      logger.error({ error, to }, 'Resend: failed to send subscription confirmation');
    } else {
      logger.info({ id: data?.id, to }, 'Resend: subscription confirmation sent');
    }
  } catch (err) {
    logger.error({ err, to }, 'Resend: unexpected error sending subscription confirmation');
  }
}

export async function sendPaymentFailed(to: string) {
  try {
    const resend = getResendClient();
    const { data, error } = await resend.emails.send({
      from: FROM,
      to,
      subject: `Action needed: Your Content Rocket payment failed`,
      html: paymentFailedHtml(),
    });
    if (error) {
      logger.error({ error, to }, 'Resend: failed to send payment-failed email');
    } else {
      logger.info({ id: data?.id, to }, 'Resend: payment-failed email sent');
    }
  } catch (err) {
    logger.error({ err, to }, 'Resend: unexpected error sending payment-failed email');
  }
}
