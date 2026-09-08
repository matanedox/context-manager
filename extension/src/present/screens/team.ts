/** Team screen: the roster of personas to click, plus the first-run setup prompt. */
import { isGuide, personaDisplayName } from "../../data/personas";
import type { BoardSnapshot } from "../../data/snapshot";
import { personaDisplay, personaName } from "../persona";

/** A persona is one stable identity, so its role and name appear together on the roster card. */
export type TeamScreen = {
  needsSetup: boolean;
  roster: Array<{
    role: string;
    roleLabel: string;
    name?: string;
    removable: boolean;
    dimmed: boolean;
  }>;
};

export function buildTeam(snapshot: BoardSnapshot): TeamScreen {
  const { context, usingDemo } = snapshot;
  const hasProjectManager = context.personas.some((entry) => entry.id === "project-manager");
  const personas = [...context.personas].sort((left, right) => {
    if (left.id === "project-manager") return -1;
    if (right.id === "project-manager") return 1;
    if (hasProjectManager && isGuide(left.id)) return 1;
    if (hasProjectManager && isGuide(right.id)) return -1;
    return 0;
  });
  return {
    needsSetup: !usingDemo && context.personaSource === "fallback",
    roster: personas.map((entry) => ({
      role: entry.id,
      ...personaDisplay(entry.id, personaName(entry.id, personaDisplayName(entry)), entry.title),
      // No card is kept against the user's wishes. Onboarding is a preference either way; a project
      // persona needs a roster file to be removed from, which the preview roster is not.
      removable: isGuide(entry.id) || context.personaSource !== "fallback",
      // Onboarding stays available for extension setup and support after the project team takes over.
      dimmed: hasProjectManager && isGuide(entry.id),
    })),
  };
}
