// 复用 dsh-pet 的纯逻辑层（物理 / 抽选 / 移动几何 / 菜单树），由 tools/build-shared.mjs 打包成 lib/shared.mjs 供 QML 导入。
// 这里只做 re-export，不改写逻辑：手感与原插件逐位一致。
export {
  DEFAULT_PHYSICS,
  SQ_SQUASH,
  SQ_DURATION_MS,
  landingSquash,
  squashScale,
  trimTrail,
  springStep,
  estimateReleaseVelocity,
  throwSpace,
  throwStepRegion,
  bodyPixelBox,
  rectsOverlap,
  collidePet,
} from '@dsh/shared/physics';
export {
  pick,
  pickSlot,
  slotIncludes,
  poolIncludes,
  isEventAnim,
  nextWorkStatusAnim,
  rollKind,
  pickCategoryAction,
} from '@dsh/shared/pickers';
export { planMove, anchorPixel } from '@dsh/shared/motion';
export { buildMenuTree, isNoMirrorAnimation } from '@dsh/shared/menu';
export { WORK_STATUS_STATES, WORK_STATUS_INDEX } from '@dsh/shared/work-status';
export { CANVAS_H, FEET_Y, HIT_BOX, DRAG_THRESHOLD, PET_REF_WIDTH } from '@dsh/shared/constants';
