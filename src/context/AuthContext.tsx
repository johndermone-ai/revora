import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile, Business, BusinessMember, UserRole } from '../types/database';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  businesses: { business: Business; role: UserRole }[];
  activeBusiness: Business | null;
  activeRole: UserRole | null;
  loading: boolean;
  /** true while memberships/businesses are being fetched for the signed-in user */
  businessesLoading: boolean;
  setActiveBusinessId: (id: string) => void;
  refreshBusinesses: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<BusinessMember[]>([]);
  const [businesses, setBusinesses] = useState<{ business: Business; role: UserRole }[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [businessesLoading, setBusinessesLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!session?.user) {
        setProfile(null);
        setMemberships([]);
        setBusinesses([]);
        setActiveBusinessId(null);
        setBusinessesLoading(false);
        return;
      }
      setBusinessesLoading(true);
      const [{ data: profileData }, { data: memberData }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', session.user.id).single(),
        supabase.from('business_members').select('*').eq('user_id', session.user.id),
      ]);
      if (cancelled) return;
      setProfile((profileData as Profile) ?? null);
      const members = (memberData as BusinessMember[]) ?? [];
      setMemberships(members);

      if (members.length > 0) {
        const { data: bizData } = await supabase
          .from('businesses')
          .select('*')
          .in('id', members.map((m) => m.business_id));
        if (cancelled) return;
        const list = ((bizData as Business[]) ?? []).map((business) => ({
          business,
          role: members.find((m) => m.business_id === business.id)?.role ?? 'staff',
        }));
        setBusinesses(list);
        setActiveBusinessId((prev) => {
          if (prev && list.some((b) => b.business.id === prev)) return prev;
          return list[0].business.id;
        });
      } else {
        setBusinesses([]);
        setActiveBusinessId(null);
      }
      setBusinessesLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  const activeBusiness =
    businesses.find((b) => b.business.id === activeBusinessId)?.business ?? null;
  const activeRole = businesses.find((b) => b.business.id === activeBusinessId)?.role ?? null;

  const value: AuthState = {
    session,
    user: session?.user ?? null,
    profile,
    businesses,
    activeBusiness,
    activeRole,
    loading,
    businessesLoading,
    setActiveBusinessId: (id) => setActiveBusinessId(id),
    refreshBusinesses: async () => {
      if (!session?.user) return;
      setBusinessesLoading(true);
      const { data: memberData } = await supabase.from('business_members').select('*').eq('user_id', session.user.id);
      const members = (memberData as BusinessMember[]) ?? [];
      setMemberships(members);
      if (members.length > 0) {
        const { data: bizData } = await supabase.from('businesses').select('*').in('id', members.map((m) => m.business_id));
        const list = ((bizData as Business[]) ?? []).map((business) => ({
          business,
          role: members.find((m) => m.business_id === business.id)?.role ?? 'staff',
        }));
        setBusinesses(list);
        setActiveBusinessId((prev) => {
          if (prev && list.some((b) => b.business.id === prev)) return prev;
          return list[0]?.business.id ?? null;
        });
      }
      setBusinessesLoading(false);
    },
    signOut: async () => {
      await supabase.auth.signOut();
      setSession(null);
      setBusinesses([]);
      setActiveBusinessId(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
