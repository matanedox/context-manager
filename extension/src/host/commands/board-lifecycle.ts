/** Hook install, uninstall, and the first-run walkthrough. */
import { GUIDE_PERSONA } from '../../data/personas';
import { walkthroughDue } from '../../data/intro';
import { checkHooks, promptInstallHooks } from '../../data/hooks-install';
import { removeEverything, repairInstall } from './reset';
import type { Role } from '../../model/roles';

export type BoardLifecycle = {
	usingDemo: boolean;
	hooksOffered: boolean;
	extensionPath: string;
	refreshAll: () => void;
	startSession: (role: Role) => void;
	markHooksOffered: () => void;
};

export function installHooks(life: BoardLifecycle, root: string | undefined): void {
	void repairInstall(root, life.extensionPath, life.usingDemo).then((ready) => {
		life.refreshAll();
		if (ready) openWalkthrough(life, root);
	});
}

export async function removeAll(life: BoardLifecycle, root: string | undefined): Promise<boolean> {
	const removed = await removeEverything(root, life.extensionPath, life.usingDemo);
	if (removed) life.markHooksOffered();
	life.refreshAll();
	return removed;
}

export function openWalkthrough(life: BoardLifecycle, root: string | undefined): void {
	if (walkthroughDue(root)) life.startSession(GUIDE_PERSONA.id);
}

export async function warnMissingHooks(life: BoardLifecycle, root: string | undefined): Promise<void> {
	if (life.hooksOffered || checkHooks(root).ready) return;
	life.markHooksOffered();
	if (await promptInstallHooks(root, life.extensionPath)) life.refreshAll();
}
