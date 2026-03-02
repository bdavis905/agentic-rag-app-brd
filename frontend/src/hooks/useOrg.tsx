import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "@/types";

interface Org {
  _id: Id<"organizations">;
  name: string;
  role: "owner" | "admin" | "member";
}

interface OrgContextValue {
  activeOrgId: string | null;
  activeOrgName: string | null;
  orgs: Org[];
  loading: boolean;
  switchOrg: (orgId: Id<"organizations">) => Promise<void>;
  createOrg: (name: string) => Promise<Id<"organizations">>;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();

  // Skip org queries until authenticated
  const orgs = useQuery(
    api.organizations.queries.list,
    isAuthenticated ? {} : "skip"
  ) as Org[] | undefined;
  const activeOrgIdRaw = useQuery(
    api.organizations.queries.getActiveOrg,
    isAuthenticated ? {} : "skip"
  );
  const switchOrgMutation = useMutation(api.organizations.mutations.switchOrg);
  const createOrgMutation = useMutation(api.organizations.mutations.create);
  const ensureMembership = useAction(api.organizations.actions.ensureMembership);

  // Auto-join: when authenticated user has 0 orgs, add them to Genesis
  const autoJoinAttempted = useRef(false);
  useEffect(() => {
    if (
      isAuthenticated &&
      orgs !== undefined &&
      orgs.length === 0 &&
      !autoJoinAttempted.current
    ) {
      autoJoinAttempted.current = true;
      ensureMembership({}).catch((err) => {
        console.error("Auto-join failed:", err);
      });
    }
  }, [isAuthenticated, orgs, ensureMembership]);

  // Reset auto-join flag on sign out
  useEffect(() => {
    if (!isAuthenticated) {
      autoJoinAttempted.current = false;
    }
  }, [isAuthenticated]);

  const loading = !isAuthenticated || orgs === undefined || activeOrgIdRaw === undefined;

  // Resolve active org — fall back to first org if no preference set
  let activeOrgId: string | null = null;
  let activeOrgName: string | null = null;

  if (!loading && orgs && orgs.length > 0) {
    if (activeOrgIdRaw && orgs.some((o) => String(o._id) === String(activeOrgIdRaw))) {
      activeOrgId = String(activeOrgIdRaw);
      activeOrgName = orgs.find((o) => String(o._id) === String(activeOrgIdRaw))?.name ?? null;
    } else {
      // Default to first org
      activeOrgId = String(orgs[0]._id);
      activeOrgName = orgs[0].name;
    }
  }

  const switchOrg = async (orgId: Id<"organizations">) => {
    await switchOrgMutation({ orgId });
  };

  const createOrg = async (name: string): Promise<Id<"organizations">> => {
    return (await createOrgMutation({ name })) as Id<"organizations">;
  };

  return (
    <OrgContext.Provider
      value={{
        activeOrgId,
        activeOrgName,
        orgs: orgs ?? [],
        loading,
        switchOrg,
        createOrg,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg(): OrgContextValue {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error("useOrg must be used within an OrgProvider");
  }
  return context;
}
