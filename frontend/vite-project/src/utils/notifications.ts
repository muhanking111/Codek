import {
  globalWorkbenchNotificationService,
  type WorkbenchNotificationItem,
  type WorkbenchNotificationOwnerEvidence,
  type WorkbenchNotificationSeverity,
} from "../workbench/statusNotificationProgressService"

type NotificationType = WorkbenchNotificationSeverity

type NotificationItem = WorkbenchNotificationItem

type NotificationListener = (items: NotificationItem[]) => void

function addNotification(type: NotificationType, message: string, duration?: number): string {
  return globalWorkbenchNotificationService.notify({ severity: type, message, duration }).id
}

function dismissNotification(id: string): void {
  globalWorkbenchNotificationService.dismissNotification(id)
}

function clearNotifications(): void {
  globalWorkbenchNotificationService.clearNotifications()
}

function subscribe(listener: NotificationListener): () => void {
  const disposable = globalWorkbenchNotificationService.onDidChangeNotifications(listener)
  return () => { disposable.dispose() }
}

function getNotifications(): NotificationItem[] {
  return globalWorkbenchNotificationService.getNotifications()
}

function getNotificationOwnerEvidence(): WorkbenchNotificationOwnerEvidence {
  return globalWorkbenchNotificationService.getNotificationOwnerEvidence()
}

function getNotificationFacadeOwnerEvidence(): {
  readonly owner: "utils/notifications"
  readonly status: "connected"
  readonly stateSource: "globalWorkbenchNotificationService"
  readonly noSecondState: true
  readonly queueSource: WorkbenchNotificationOwnerEvidence["queueSource"]
  readonly visibleSource: WorkbenchNotificationOwnerEvidence["visibleSource"]
} {
  const evidence = getNotificationOwnerEvidence()
  return {
    owner: "utils/notifications",
    status: "connected",
    stateSource: "globalWorkbenchNotificationService",
    noSecondState: true,
    queueSource: evidence.queueSource,
    visibleSource: evidence.visibleSource,
  }
}

function invokeNotificationAction(id: string, actionId: string): Promise<boolean> {
  return globalWorkbenchNotificationService.invokeNotificationAction(id, actionId)
}

export type { NotificationType, NotificationItem, NotificationListener }
export {
  addNotification,
  dismissNotification,
  clearNotifications,
  subscribe,
  getNotifications,
  getNotificationOwnerEvidence,
  getNotificationFacadeOwnerEvidence,
  invokeNotificationAction,
}

export function notify(type: NotificationType, message: string, duration?: number): string {
  return addNotification(type, message, duration)
}
