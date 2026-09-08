/**
 * Screen registry. `Record<Page, ScreenBuilder>` is the contract: add an id to PAGES and this
 * file will not compile until that screen has a builder.
 */
import type { BoardSnapshot } from "../../data/snapshot";
import type { Selection } from "../selection";
import type { Page } from "../ui";
import { buildAgent, type AgentScreen } from "./agent";
import { buildTeam, type TeamScreen } from "./team";

type ScreenBuilder = (snapshot: BoardSnapshot, selection: Selection) => object;

const SCREENS: Record<Page, ScreenBuilder> = {
  team: buildTeam,
  agent: buildAgent,
};

export type ScreenPayload = TeamScreen & AgentScreen;

/**
 * Every screen is built on each refresh, so the payload stays one flat object and switching
 * screens needs no round trip to the host.
 */
export function buildScreens(snapshot: BoardSnapshot, selection: Selection): ScreenPayload {
  return Object.assign({}, ...Object.values(SCREENS).map((build) => build(snapshot, selection))) as ScreenPayload;
}
