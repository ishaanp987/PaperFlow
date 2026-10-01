import { AppError, safeError } from "./errors.ts";
import { createOpenAI, createNotion, studyBlocks, blockText } from "./providers.ts";
import { validateStudy } from "./model.ts";
import type { Store } from "./storage.ts";
import type { Settings } from "./config.ts";
import type { ApiFetch } from "./providers.ts";

export function createPipeline(store: Store, settings: () => Settings, apiFetch: ApiFetch = fetch) {
  const running = new Set<string>();
  // Serialize publishing because several lectures may create the same course page.
  let publishing = false;
  const processLecture = async (id: string) => {
    const lecture = store.requireLecture(id);
    if (running.has(id) || lecture.status === "publishing") throw new AppError("This lecture is already being processed.", 409);
    if (lecture.study || lecture.publishStarted) throw new AppError("This lecture already has a study guide.", 409);
    const config = settings(); const ai = createOpenAI(config, apiFetch);
    running.add(id); lecture.status = lecture.transcription ? "generating" : "extracting"; lecture.error = null; lecture.model = config.model; store.save(lecture);
    try {
      if (!lecture.transcription) {
        const result = await ai.extract(await store.pdf(id), lecture.pageCount);
        lecture.transcription = result.transcription; lecture.usage.input += result.usage.input; lecture.usage.output += result.usage.output;
        lecture.status = "generating"; store.save(lecture);
      }
      const result = await ai.generate(lecture.transcription, lecture.pageCount);
      lecture.study = result.study; lecture.usage.input += result.usage.input; lecture.usage.output += result.usage.output;
      lecture.status = "ready"; store.save(lecture);
    } catch (error) { lecture.status = "processing_error"; lecture.error = safeError(error).message; store.save(lecture); }
    finally { running.delete(id); }
    return lecture;
  };

  const publishLecture = async (id: string) => {
    const lecture = store.requireLecture(id);
    if (publishing || running.has(id)) throw new AppError("Another publish is running. Wait for it to finish.", 409);
    if (!lecture.study) throw new AppError("Generate and review a study guide first.", 409);
    if (lecture.status === "published") return lecture;
    if (lecture.source === "demo") throw new AppError("Demo guides cannot be published. Upload a PDF to create your own guide.", 409);
    const config = settings(); const notion = createNotion(config, apiFetch);
    if (lecture.notionParentId && lecture.notionParentId !== config.notionParentId && (lecture.coursePageId || lecture.notionPageId)) throw new AppError("This publish began in a different Notion destination. Restore that parent page in Settings to complete it.", 409);
    validateStudy(lecture.study, lecture.pageCount);
    publishing = true; running.add(id); lecture.publishStarted = true; lecture.notionParentId = config.notionParentId;
    lecture.status = "publishing"; lecture.error = null; store.save(lecture);
    try {
      let courseId = lecture.coursePageId || store.course(config.notionParentId, lecture.study.course);
      if (!courseId) {
        const children = await notion.children(config.notionParentId);
        const existing = children.find(block => block.type === "child_page" && block.child_page.title === lecture.study!.course);
        courseId = existing?.id;
        if (!courseId) courseId = (await notion.page(config.notionParentId, lecture.study.course, [])).id;
        store.saveCourse(config.notionParentId, lecture.study.course, courseId!);
      }
      lecture.coursePageId = courseId!; store.save(lecture);
      const marker = `PaperFlow source: ${lecture.id}`;
      if (!lecture.notionPageId) {
        // A previous request may have succeeded before its response was lost.
        // Find the unique source marker before attempting another page creation.
        const candidates = (await notion.children(courseId!)).filter(block => block.type === "child_page");
        for (const candidate of candidates) {
          const content = await notion.children(candidate.id);
          if (content.some(block => blockText(block) === marker)) {
            lecture.notionPageId = candidate.id; lecture.notionUrl = `https://www.notion.so/${candidate.id.replace(/-/g, "")}`; break;
          }
        }
        if (!lecture.notionPageId) {
          const blocks = studyBlocks(lecture.study, marker);
          // Notion caps the top-level children array at 100. Group long sections
          // inside toggles so even large guides fit one atomic create request.
          const children = blocks.length <= 100 ? blocks : [blocks[0], ...groupBlocks(blocks.slice(1))];
          const page = await notion.page(courseId!, `${lecture.study.date ? lecture.study.date + " — " : ""}${lecture.study.title}`, children);
          lecture.notionPageId = page.id; lecture.notionUrl = page.url || `https://www.notion.so/${page.id.replace(/-/g, "")}`;
        }
        store.save(lecture);
      }
      const caption = `Original notes · ${marker}`;
      if (!lecture.fileAttached) {
        const content = await notion.children(lecture.notionPageId!);
        lecture.fileAttached = content.some(block => block.type === "pdf" && blockText(block) === caption);
        if (!lecture.fileAttached) {
          await notion.attach(lecture.notionPageId!, await store.pdf(id), lecture.filename, caption);
          lecture.fileAttached = true;
        }
      }
      lecture.status = "published"; lecture.error = null; store.save(lecture);
    } catch (error) { lecture.status = "partial"; lecture.error = safeError(error).message; store.save(lecture); }
    finally { publishing = false; running.delete(id); }
    return lecture;
  };
  return { processLecture, publishLecture };
}

function groupBlocks(blocks: any[]) {
  const groups: any[] = []; let current: any[] = []; let title = "Lecture details";
  const flush = () => { if (current.length) groups.push({ object: "block", type: "toggle", toggle: { rich_text: [{ type: "text", text: { content: title } }], children: current } }); current = []; };
  for (const block of blocks) {
    if (block.type === "heading_2") { flush(); title = blockText(block); }
    else current.push(block);
  }
  flush(); return groups;
}
