import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { UserButton } from "@clerk/clerk-react";
import { Plus, Trash2, Settings, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { useOrg } from "@/hooks/useOrg";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { Id } from "@/types";
import logo from "/logo-brd.jpg";

type Skill = Doc<"skills">;

interface SkillFormState {
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
}

const emptyForm: SkillFormState = {
  name: "",
  description: "",
  instructions: "",
  enabled: true,
};

export function SkillsPage() {
  const navigate = useNavigate();
  const { activeOrgId } = useOrg();

  const skills = useQuery(
    api.skills.queries.list,
    activeOrgId ? { orgId: activeOrgId } : "skip",
  );

  const createSkill = useMutation(api.skills.mutations.create);
  const updateSkill = useMutation(api.skills.mutations.update);
  const removeSkill = useMutation(api.skills.mutations.remove);
  const toggleEnabled = useMutation(api.skills.mutations.toggleEnabled);

  const [selectedId, setSelectedId] = useState<Id<"skills"> | "new" | null>(null);
  const [form, setForm] = useState<SkillFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openNew = () => {
    setSelectedId("new");
    setForm(emptyForm);
    setError(null);
  };

  const selectSkill = (skill: Skill) => {
    setSelectedId(skill._id);
    setForm({
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      enabled: skill.enabled,
    });
    setError(null);
  };

  const handleSave = async () => {
    if (!activeOrgId) return;
    if (!form.name.trim() || !form.description.trim() || !form.instructions.trim()) {
      setError("All fields are required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (selectedId === "new") {
        const newId = await createSkill({
          orgId: activeOrgId,
          name: form.name.trim(),
          description: form.description.trim(),
          instructions: form.instructions.trim(),
          enabled: form.enabled,
        });
        setSelectedId(newId);
      } else if (selectedId) {
        await updateSkill({
          orgId: activeOrgId,
          skillId: selectedId,
          name: form.name.trim(),
          description: form.description.trim(),
          instructions: form.instructions.trim(),
          enabled: form.enabled,
        });
      }
    } catch (e: any) {
      setError(e.message || "Failed to save skill.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, skillId: Id<"skills">) => {
    e.stopPropagation();
    if (!activeOrgId) return;
    try {
      await removeSkill({ orgId: activeOrgId, skillId });
      if (selectedId === skillId) {
        setSelectedId(null);
        setForm(emptyForm);
      }
    } catch (err: any) {
      setError(err.message || "Failed to delete skill.");
    }
  };

  const handleToggle = async (e: React.MouseEvent, skillId: Id<"skills">) => {
    e.stopPropagation();
    if (!activeOrgId) return;
    await toggleEnabled({ orgId: activeOrgId, skillId });
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="flex w-64 flex-col border-r border-border/50 bg-surface-1">
        {/* Logo */}
        <div className="border-b border-border/50 p-4">
          <img src={logo} alt="Genesis" className="h-24" />
        </div>

        {/* Org Switcher */}
        <OrgSwitcher />

        {/* Navigation Tabs */}
        <nav className="border-b border-border/50 p-2">
          <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
            <button
              onClick={() => navigate("/")}
              className="flex-1 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-background/50 transition-all duration-200"
            >
              Chat
            </button>
            <button
              onClick={() => navigate("/documents")}
              className="flex-1 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-background/50 transition-all duration-200"
            >
              Documents
            </button>
            <button className="flex-1 px-3 py-1.5 rounded-md text-sm font-medium bg-background shadow-sm transition-all duration-200">
              Skills
            </button>
          </div>
        </nav>

        {/* New Skill Button */}
        <div className="p-2">
          <Button onClick={openNew} variant="outline" size="sm" className="w-full justify-start">
            <Plus className="mr-1.5 h-4 w-4" />
            New Skill
          </Button>
        </div>

        {/* Skills List */}
        <div className="flex-1 min-h-0 overflow-auto">
          {skills === undefined ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">Loading...</div>
          ) : skills.length === 0 && selectedId !== "new" ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">No skills yet</div>
          ) : (
            <div className="py-1">
              {skills?.map((skill: Skill) => (
                <button
                  key={skill._id}
                  onClick={() => selectSkill(skill)}
                  className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors ${
                    selectedId === skill._id
                      ? "bg-accent/50"
                      : "hover:bg-accent/30"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate">{skill.name}</span>
                      <span
                        className={`shrink-0 h-1.5 w-1.5 rounded-full ${
                          skill.enabled ? "bg-green-500" : "bg-muted-foreground/40"
                        }`}
                        title={skill.enabled ? "Enabled" : "Disabled"}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {skill.description}
                    </p>
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, skill._id)}
                    className="shrink-0 p-1 rounded hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 hover:!opacity-100"
                    style={{ opacity: selectedId === skill._id ? 1 : undefined }}
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  </button>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* User Menu */}
        <div className="border-t border-border/50 p-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <UserButton afterSignOutUrl="/" />
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => navigate("/settings")}
                className="p-2 rounded-lg hover:bg-accent/50 transition-colors"
                title="Settings"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content — Editor or Empty State */}
      <div className="flex-1 flex flex-col bg-background">
        {selectedId ? (
          <>
            {/* Editor Header */}
            <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
              <h1 className="text-lg font-semibold">
                {selectedId === "new" ? "New Skill" : form.name || "Edit Skill"}
              </h1>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 mr-2">
                  <button
                    onClick={() => setForm({ ...form, enabled: !form.enabled })}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      form.enabled ? "bg-primary" : "bg-muted"
                    }`}
                    title={form.enabled ? "Disable" : "Enable"}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${
                        form.enabled ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                  <span className="text-sm text-muted-foreground">
                    {form.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                {selectedId !== "new" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => handleDelete(e, selectedId)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete
                  </Button>
                )}
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : selectedId === "new" ? "Create" : "Save"}
                </Button>
              </div>
            </div>

            {/* Editor Form */}
            <div className="flex-1 overflow-auto p-6">
              <div className="max-w-3xl space-y-5">
                {error && (
                  <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                    {error}
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Name</label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. code-reviewer"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Short, kebab-case identifier shown in the skills catalog
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Description</label>
                  <Input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="One-line description of what this skill does"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Helps the AI decide when to activate this skill
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Instructions</label>
                  <textarea
                    value={form.instructions}
                    onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                    placeholder="Full instructions the AI should follow when this skill is activated..."
                    rows={16}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Loaded into context when the AI calls load_skill. Supports markdown.
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Empty State */
          <div className="flex h-full flex-col items-center justify-center animate-fade-in">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-semibold mb-1">Skills</h2>
              <p className="text-muted-foreground mb-6 max-w-sm">
                Create reusable instruction sets that your AI assistant can load on-demand during chat.
              </p>
              <Button onClick={openNew}>
                <Plus className="mr-1.5 h-4 w-4" />
                Create your first skill
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
