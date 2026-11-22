import { firstChapterId } from '../domain/chapters.mts';
import { chapterOneSpawn } from './chapter-one-terrain.mts';

// Standing positions for the supplied Chapter One shrines.
const checkpointSpawns = new Map<string, Readonly<{ x: number; z: number; heading: number }>>([
  ['table', { x: 9.6, z: -41.5, heading: 1 }],
  ['plateau', { x: 14.6, z: -56.6, heading: -0.2 }],
]);

export function resolveChapterOneSpawn(resume?: Readonly<{ chapter: string; shrine: unknown }>) {
  if (!resume) return chapterOneSpawn;
  if (resume.chapter !== firstChapterId) throw Error('The native preview can resume Chapter One only');
  return typeof resume.shrine === 'string' ? checkpointSpawns.get(resume.shrine) ?? chapterOneSpawn : chapterOneSpawn;
}
