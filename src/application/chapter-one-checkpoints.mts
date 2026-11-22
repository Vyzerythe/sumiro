import { firstChapterId } from '../domain/chapters.mts';
import { resolveChapterSpawn } from './chapter-checkpoints.mts';
import { chapterOneSpawn } from './chapter-one-terrain.mts';

export function resolveChapterOneSpawn(resume?: Readonly<{ chapter: string; shrine: unknown }>) {
  if (!resume) return chapterOneSpawn;
  if (resume.chapter !== firstChapterId) throw Error('The native preview can resume Chapter One only');
  return resolveChapterSpawn(firstChapterId, chapterOneSpawn, resume);
}
