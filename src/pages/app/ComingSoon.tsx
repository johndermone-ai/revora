import { ComingSoon } from '../../components/ui';

export function CalendarPage() {
  return <ComingSoon
    title="Calendar & appointments"
    description="Book appointments, set reminders, and see your follow-up schedule on a calendar. Your follow-up dates already appear on the dashboard."
    planned={['Appointment booking', 'Reminder automation', 'Google Calendar sync', 'Availability scheduling']}
  />;
}

export function AIAssistantPage() {
  return <ComingSoon
    title="AI Assistant"
    description="A workspace assistant that can draft messages, summarise leads, and answer questions about your pipeline. AI lead qualification already runs on each lead page."
    planned={['Pipeline Q&A', 'Message drafting', 'Daily digest', 'Voice notes']}
  />;
}

export function AnalyticsPage() {
  return <ComingSoon
    title="Analytics"
    description="Revenue, conversion and retention analytics built on your real lead and customer data. The dashboard already shows live pipeline metrics."
    planned={['Revenue tracking', 'Source performance', 'Conversion funnels', 'Retention reports']}
  />;
}

export function IntegrationsPage() {
  return <ComingSoon
    title="Integrations"
    description="Connect email, WhatsApp, SMS, voice, calendar and payment providers. The follow-up engine is already built channel-ready - delivery activates the moment a provider is connected."
    planned={['Email provider (e.g. Resend, Postmark)', 'WhatsApp Business API', 'SMS gateway', 'AI voice', 'Stripe payments', 'Google Calendar']}
  />;
}

export function BillingPage() {
  return <ComingSoon
    title="Billing"
    description="Manage your subscription, invoices and payment method. Your account currently runs on the built-in trial plan."
    planned={['Plan management', 'Invoices', 'Payment method', 'Usage limits']}
  />;
}
