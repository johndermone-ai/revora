// ============================================================
// Revora voice provider abstraction layer.
// Add a new provider by implementing VoiceProviderAdapter — the
// rest of the application (settings, webhook pipeline, dashboard)
// never changes. No fake simulator: every adapter talks to the
// provider's real HTTP API using server-side credentials only.
// ============================================================

export interface Faq { question: string; answer: string }

export interface AgentSettings {
  agentName: string;
  greeting: string;
  businessDescription: string;
  services: string[];
  faqs: Faq[];
  businessHours: string;
  transferNumber: string | null;
  appointmentRules: { auto_confirm?: boolean; max_slots_to_offer?: number };
  voiceSettings: { language?: string; voice?: string; speed?: number };
  behaviourInstructions: string;
  handoffRules: string[];
  compliance: {
    recording_enabled?: boolean;
    recording_consent_notice?: string;
    ai_disclosure_notice?: string;
    consent_mode?: 'notice_only' | 'verbal_consent_required';
  };
}

export type ProviderName = 'retell' | 'vapi';

export type CallEventType = 'call_started' | 'call_ended' | 'transfer_requested';

export interface NormalizedCallEvent {
  type: CallEventType;
  provider: ProviderName;
  providerCallId: string;
  from?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  transcriptUrl?: string | null;
  recordingUrl?: string | null;
  transcriptText?: string | null;
  raw: unknown;
}

export interface VoiceProviderAdapter {
  name: ProviderName;
  /** Build the provider-specific agent create/update payload. */
  toAgentPayload(settings: AgentSettings, webhookUrl: string): Record<string, unknown>;
  /** Create the agent at the provider. Returns their agent id. */
  createAgent(apiKey: string, payload: Record<string, unknown>): Promise<string>;
  /** Update an existing provider agent. */
  updateAgent(apiKey: string, agentId: string, payload: Record<string, unknown>): Promise<void>;
  /** Normalize an inbound webhook payload into Revora's shape. */
  normalizeWebhook(payload: unknown): NormalizedCallEvent;
}

// ------------------------------------------------------------
// Shared: compile settings into a provider-neutral system prompt.
// Every provider gets the same brain: greeting, business facts,
// FAQs, booking through Revora's booking engine, handoff rules
// and the owner's compliance notices (their words, their choice —
// storing notices does not make the business compliant).
// ------------------------------------------------------------

export function compileAgentPrompt(settings: AgentSettings, businessName: string, bookingEndpoint: string): string {
  const services = settings.services.filter(Boolean).map((s) => `- ${s}`).join('\n');
  const faqs = settings.faqs
    .filter((f) => f.question && f.answer)
    .map((f) => `Q: ${f.question}\nA: ${f.answer}`)
    .join('\n\n');

  const handoff = settings.handoffRules.includes('customer_requests_human')
    ? '- If the caller asks to speak to a human, transfer the call.\n'
    : '';
  const handoff2 = settings.handoffRules.includes('low_confidence')
    ? '- If you are not confident you can answer correctly, transfer the call.\n'
    : '';
  const handoff3 = settings.handoffRules.includes('sensitive_issue')
    ? '- If the caller raises a complaint, legal, medical or payment-dispute matter, transfer the call.\n'
    : '';

  const disclosure = settings.compliance.ai_disclosure_notice
    ? `\nAI DISCLOSURE (read or follow exactly as written): ${settings.compliance.ai_disclosure_notice}`
    : '\nYou are an AI assistant. If asked, say so honestly.';
  const recording = settings.compliance.recording_enabled && settings.compliance.recording_consent_notice
    ? `\nRECORDING NOTICE (follow as written): ${settings.compliance.recording_consent_notice}${
        settings.compliance.consent_mode === 'verbal_consent_required' ? ' Do not begin recording/continue until the caller agrees.' : ''
      }`
    : '';

  return `You are the phone receptionist for ${businessName}. ${settings.businessDescription}

GREETING (use to open the call): ${settings.greeting}

SERVICES:
${services || '(none listed — do not invent services; offer to take details instead)'}

APPROVED FAQs ONLY — answer other business questions by taking a message, never guessing:
${faqs || '(no FAQs configured)'}

BUSINESS HOURS: ${settings.businessHours || 'as published by the business'}

BOOKING: when the caller wants an appointment, collect their preferred day/time, name, phone and email. The booking system will validate the slot — if it is taken, offer the alternatives it returns. Bookings always use the same booking engine as the business's website and staff; never promise a slot before it is confirmed.

LEADS: collect name, phone, email, what they need, urgency and budget when relevant.

CALLER HANDOFF — transfer to a human when:
${handoff}${handoff2}${handoff3}- If no transfer number is reachable, take a message with a callback time.
${disclosure}${recording}

ADDITIONAL BEHAVIOUR INSTRUCTIONS FROM THE BUSINESS:
${settings.behaviourInstructions || '(none)'}

Do not invent prices, availability, policies or facts about the business.`;
}

// ------------------------------------------------------------
// Retell AI adapter (https://api.retellai.com)
// Webhook: business pastes their webhook URL + secret in the
// Retell dashboard; Retell posts call events (call.analyzed etc.)
// ------------------------------------------------------------
export const retellAdapter: VoiceProviderAdapter = {
  name: 'retell',

  toAgentPayload(settings, webhookUrl) {
    return {
      agent_name: settings.agentName,
      // Prompt carries all business knowledge; greeting repeated for the
      // provider's first-message field.
      response_template: {
        model: 'gpt-4o-mini',
        variables: {},
      },
      general_prompt: compileAgentPrompt(settings, settings.agentName, webhookUrl),
      greeting: settings.greeting,
      voice_id: settings.voiceSettings.voice || '11l-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // owner selects a real voice id in the dashboard
      voice_model: 'enhanced',
      language: settings.voiceSettings.language || 'en-GB',
      speed: settings.voiceSettings.speed ?? 1,
      transfer_phone_number: settings.transferNumber ?? undefined,
      webhook_url: webhookUrl,
    };
  },

  async createAgent(apiKey, payload) {
    const res = await fetch('https://api.retellai.com/v2/create-agent', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Retell create-agent failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return (data as { agent_id: string }).agent_id;
  },

  async updateAgent(apiKey, agentId, payload) {
    const res = await fetch(`https://api.retellai.com/v2/update-agent/${agentId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Retell update-agent failed (${res.status}): ${await res.text()}`);
  },

  normalizeWebhook(payload) {
    const p = payload as Record<string, unknown>;
    // Retell posts { event: 'call_started'|'call_ended'|'call_analyzed', call: {...} }
    const event = String(p.event ?? '');
    const call = (p.call ?? {}) as Record<string, unknown>;
    const callId = String(call.call_id ?? p.call_id ?? '');
    if (!callId) throw new Error('Missing call id');
    const type: CallEventType =
      event === 'call_started' ? 'call_started'
      : event === 'call_analyzed' || event === 'call_ended' ? 'call_ended'
      : 'call_ended';
    return {
      type,
      provider: 'retell',
      providerCallId: callId,
      from: (call.from_number ?? call.caller_number ?? null) as string | null ?? null,
      startedAt: (call.start_timestamp ? new Date(Number(call.start_timestamp) * (String(call.start_timestamp).length > 10 ? 1 : 1000)).toISOString() : null),
      endedAt: (call.end_timestamp ? new Date(Number(call.end_timestamp) * (String(call.end_timestamp).length > 10 ? 1 : 1000)).toISOString() : null),
      durationSeconds: (call.duration_ms != null ? Math.round(Number(call.duration_ms) / 1000) : null) as number | null,
      transcriptUrl: (call.transcript_url ?? null) as string | null,
      recordingUrl: (call.recording_url ?? null) as string | null,
      transcriptText: (call.transcript ?? null) as string | null,
      raw: payload,
    };
  },
};

// ------------------------------------------------------------
// Vapi adapter (https://api.vapi.ai)
// ------------------------------------------------------------
export const vapiAdapter: VoiceProviderAdapter = {
  name: 'vapi',

  toAgentPayload(settings, webhookUrl) {
    return {
      name: settings.agentName,
      model: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: compileAgentPrompt(settings, settings.agentName, webhookUrl) }],
      },
      voice: settings.voiceSettings.voice
        ? { provider: '11labs', voiceId: settings.voiceSettings.voice }
        : { provider: 'vapi', voiceId: 'Nancy' },
      firstMessage: settings.greeting,
      server: { url: webhookUrl },
      analysisPlan: { summaryPlan: { enabled: true }, structuredDataPlan: { enabled: true, schema: {} } },
      transferPlan: settings.transferNumber
        ? { destination: { type: 'number', number: settings.transferNumber } }
        : undefined,
    };
  },

  async createAgent(apiKey, payload) {
    const res = await fetch('https://api.vapi.ai/agent', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Vapi create-agent failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return (data as { id: string }).id;
  },

  async updateAgent(apiKey, agentId, payload) {
    const res = await fetch(`https://api.vapi.ai/agent/${agentId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Vapi update-agent failed (${res.status}): ${await res.text()}`);
  },

  normalizeWebhook(payload) {
    const p = payload as Record<string, unknown>;
    const type0 = String(p.type ?? p.message?.type ?? '');
    const message = (p.message ?? p.call ?? {}) as Record<string, unknown>;
    const callId = String(message.id ?? p.callId ?? p.call_id ?? '');
    if (!callId) throw new Error('Missing call id');
    const type: CallEventType =
      type0 === 'call-start' ? 'call_started'
      : type0 === 'end-of-call-report' || type0 === 'call-end' ? 'call_ended'
      : 'call_ended';
    const startedAt = (message.startedAt ?? message.timestamp ?? null) as string | null;
    const endedAt = (message.endedAt ?? null) as string | null;
    return {
      type,
      provider: 'vapi',
      providerCallId: callId,
      from: ((message.customer ?? {}) as Record<string, unknown>).number ? String(((message.customer ?? {}) as Record<string, unknown>).number) : null,
      startedAt: startedAt ? new Date(startedAt).toISOString() : null,
      endedAt: endedAt ? new Date(endedAt).toISOString() : null,
      durationSeconds: message.durationSeconds != null ? Number(message.durationSeconds) : null,
      transcriptUrl: message.transcriptUrl ?? null,
      recordingUrl: message.recordingUrl ?? null,
      transcriptText: message.transcriptText ?? null,
      raw: payload,
    };
  },
};

export function getAdapter(provider: string): VoiceProviderAdapter {
  if (provider === 'retell') return retellAdapter;
  if (provider === 'vapi') return vapiAdapter;
  throw new Error(`Unsupported voice provider: ${provider}`);
}
