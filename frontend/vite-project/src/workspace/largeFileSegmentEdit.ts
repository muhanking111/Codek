export {
  applyLargeFileSegmentPatchToContent,
  buildLargeFileSegmentPatchPlan,
  createLargeFileEditBufferSavePlan,
  createLargeFileSegmentEditStackItem,
  createLargeFileSegmentRedoPlan,
  createLargeFileSegmentUndoPlan,
  getUtf8ByteLength,
  hashLargeFileSegment,
  pushLargeFileSegmentEditStackItem,
  validateLargeFileSegmentPatchPlan,
} from "../vscode-adapter/editor/common/model/largeFileEditBuffer"

export type {
  LargeFileEditBufferSaveInput,
  LargeFileEditBufferSaveResult,
  LargeFileEditBufferState,
  LargeFileRememberedWindow,
  LargeFileSegmentEditSnapshot,
  LargeFileSegmentEditStack,
  LargeFileSegmentEditStackItem,
  LargeFileSegmentEditStackItemInput,
  LargeFileSegmentEditStackPlanInput,
  LargeFileSegmentEditStackPlanResult,
  LargeFileSegmentPatchPlan,
  LargeFileSegmentPatchValidation,
  LargeFileSegmentState,
} from "../vscode-adapter/editor/common/model/largeFileEditBuffer"
