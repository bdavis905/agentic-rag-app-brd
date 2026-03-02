import { useUser, useClerk } from "@clerk/clerk-react";
import { useConvexAuth } from "convex/react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useOrg } from "./useOrg";

interface AuthUser {
  id: string;
  email: string;
}

export function useAuth() {
  const { user: clerkUser, isLoaded: userLoaded } = useUser();
  const { isAuthenticated, isLoading: convexLoading } = useConvexAuth();
  const clerk = useClerk();
  const { orgs } = useOrg();

  // Check platform admin status — skip when not authenticated
  const isPlatformAdmin = useQuery(
    api.organizations.queries.isPlatformAdmin,
    isAuthenticated ? {} : "skip"
  );

  const loading = !userLoaded || convexLoading;

  const user: AuthUser | null =
    isAuthenticated && clerkUser
      ? {
          id: clerkUser.id,
          email: clerkUser.primaryEmailAddress?.emailAddress ?? "",
        }
      : null;

  // isAdmin if user is owner/admin in any org, or is platform admin
  const isOrgAdmin = orgs?.some((m) => m.role === "owner" || m.role === "admin") ?? false;
  const isAdmin = isOrgAdmin || isPlatformAdmin === true;

  const signOut = async () => {
    await clerk.signOut();
  };

  const getToken = async () => {
    return (await clerk.session?.getToken({ template: "convex" })) ?? null;
  };

  return {
    user,
    loading,
    isAdmin,
    isPlatformAdmin: isPlatformAdmin === true,
    signOut,
    getToken,
  };
}
