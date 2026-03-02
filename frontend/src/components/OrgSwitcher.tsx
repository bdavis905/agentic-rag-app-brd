import { useState } from "react";
import { ChevronDown, Plus, Building2, Check } from "lucide-react";
import { useOrg } from "@/hooks/useOrg";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function OrgSwitcher() {
  const { activeOrgId, activeOrgName, orgs, loading, switchOrg, createOrg } =
    useOrg();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="px-3 py-2">
        <div className="h-8 rounded-lg bg-muted/30 animate-pulse" />
      </div>
    );
  }

  // No orgs — show create prompt
  if (orgs.length === 0) {
    return (
      <div className="px-3 py-2">
        <div className="rounded-lg border border-border/50 bg-card p-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Create an organization to get started.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newOrgName.trim() || submitting) return;
              setSubmitting(true);
              try {
                await createOrg(newOrgName.trim());
                setNewOrgName("");
              } catch (err) {
                console.error("Failed to create org:", err);
              } finally {
                setSubmitting(false);
              }
            }}
            className="flex gap-2"
          >
            <Input
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="Organization name"
              className="h-8 text-sm"
              disabled={submitting}
            />
            <Button
              type="submit"
              size="sm"
              className="h-8 shrink-0"
              disabled={!newOrgName.trim() || submitting}
            >
              Create
            </Button>
          </form>
        </div>
      </div>
    );
  }

  const handleCreateOrg = async () => {
    if (!newOrgName.trim() || submitting) return;
    setSubmitting(true);
    try {
      await createOrg(newOrgName.trim());
      setNewOrgName("");
      setCreating(false);
      setOpen(false);
    } catch (err) {
      console.error("Failed to create org:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="px-3 py-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium bg-muted/30 hover:bg-muted/50 transition-colors">
            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="truncate flex-1 text-left">
              {activeOrgName ?? "Select organization"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1" align="start" sideOffset={4}>
          <div className="max-h-48 overflow-y-auto">
            {orgs.map((org) => (
              <button
                key={String(org._id)}
                onClick={() => {
                  switchOrg(org._id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  String(org._id) === activeOrgId
                    ? "bg-accent/50 text-foreground"
                    : "text-foreground hover:bg-accent/30"
                }`}
              >
                <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate flex-1 text-left">{org.name}</span>
                {String(org._id) === activeOrgId && (
                  <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                )}
              </button>
            ))}
          </div>
          <div className="border-t border-border/30 mt-1 pt-1">
            {creating ? (
              <div className="flex gap-2 px-2 py-1.5">
                <Input
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="Organization name"
                  className="h-7 text-xs"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleCreateOrg()}
                  disabled={submitting}
                />
                <Button
                  size="sm"
                  className="h-7 text-xs shrink-0"
                  onClick={handleCreateOrg}
                  disabled={!newOrgName.trim() || submitting}
                >
                  Create
                </Button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Create Organization
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
