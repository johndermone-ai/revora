import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import PublicLayout from './components/layout/PublicLayout';
import AppLayout from './components/layout/AppLayout';
import { RequireAuth, RequireBusiness } from './routes/Protected';
import Landing from './pages/public/Landing';
import Pricing from './pages/public/Pricing';
import Login from './pages/public/Login';
import Signup from './pages/public/Signup';
import ForgotPassword from './pages/public/ForgotPassword';
import ResetPassword from './pages/public/ResetPassword';
import CapturePage from './pages/public/CapturePage';
import OnboardingWizard from './pages/onboarding/OnboardingWizard';
import Dashboard from './pages/app/Dashboard';
import Leads from './pages/app/Leads';
import LeadDetail from './pages/app/LeadDetail';
import Customers from './pages/app/Customers';
import Activities from './pages/app/Activities';
import Tasks from './pages/app/Tasks';
import Automations from './pages/app/Automations';
import Settings from './pages/app/Settings';
import CalendarPage from './pages/app/CalendarPage';
import RecoveryPage from './pages/app/RecoveryPage';
import { AIAssistantPage, BillingPage, IntegrationsPage } from './pages/app/ComingSoon';
import AnalyticsPage from './pages/app/AnalyticsPage';
import { Spinner } from './components/ui';

function AppRoutes() {
  const { session, loading } = useAuth();
  return (
    <Routes>
      {/* Public */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/login" element={loading ? <Spinner /> : session ? <Navigate to="/app" replace /> : <Login />} />
        <Route path="/signup" element={loading ? <Spinner /> : session ? <Navigate to="/app" replace /> : <Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={session ? <ResetPassword /> : <Navigate to="/login" replace />} />
        <Route path="/capture/:businessId" element={<CapturePage />} />
      </Route>

      {/* Authenticated: onboarding */}
      <Route path="/onboarding" element={<RequireAuth><OnboardingWizard /></RequireAuth>} />

      {/* Authenticated: app */}
      <Route path="/app" element={<RequireAuth><RequireBusiness><AppLayout /></RequireBusiness></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="leads" element={<Leads />} />
        <Route path="leads/:leadId" element={<LeadDetail />} />
        <Route path="customers" element={<Customers />} />
        <Route path="activities" element={<Activities />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="recovery" element={<RecoveryPage />} />
        <Route path="automations" element={<Automations />} />
        <Route path="ai-assistant" element={<AIAssistantPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="settings" element={<Settings />} />
        <Route path="billing" element={<BillingPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
