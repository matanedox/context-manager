/** Shared markdown/frontmatter helpers for reading workspace context files. */
import * as fs from 'fs';
import * as path from 'path';

export function slugify(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
}

export function markdownFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const file = path.join(dir, entry.name);
		if (entry.isDirectory()) return markdownFiles(file);
		return /\.(md|mdc)$/i.test(entry.name) ? [file] : [];
	});
}

export function relativePath(root: string, file: string): string {
	return path.relative(root, file).split(path.sep).join('/');
}

export function frontmatter(text: string): string {
	return text.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? '';
}

export function metaValue(metadata: string, key: string): string | undefined {
	const match = metadata.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
	return match?.[1]?.trim().replace(/^["']|["']$/g, '');
}

export function metaList(metadata: string, keys: string[]): string[] {
	for (const key of keys) {
		const raw = metaValue(metadata, key);
		if (!raw) continue;
		return raw
			.replace(/^\[|\]$/g, '')
			.split(/[,\s]+/)
			.map((part) => part.trim())
			.filter(Boolean);
	}
	return [];
}
