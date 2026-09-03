export type ExhaustedObjectiveCorrectionState = {
  objectiveReviewCall: boolean;
  objectiveInputCorrectionCall: boolean;
  objectiveInputCorrectionAttempted: boolean;
  objectiveCorrectionAttempted: boolean;
  workspaceMutationObserved: boolean;
  verificationCompletedReadCount: number;
  requiredChangedPathCount: number;
};

export function canRetainVerifiedMutationAfterExhaustedObjectiveCorrection(
  state: ExhaustedObjectiveCorrectionState,
): boolean {
  return state.objectiveReviewCall
    && state.objectiveInputCorrectionCall
    && state.objectiveInputCorrectionAttempted
    && !state.objectiveCorrectionAttempted
    && state.workspaceMutationObserved
    && state.requiredChangedPathCount > 0
    && state.verificationCompletedReadCount === state.requiredChangedPathCount;
}
