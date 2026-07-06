// VS Code source adapter.
// Source reference:
// - D:\SourceMirror\vscode\src\vs\workbench\services\userDataProfile\common\userDataProfileService.ts

import { Emitter, type Event } from "../../../base/common/event"
import { Disposable } from "../../../base/common/lifecycle"
import { serializeUserDataProfile, type UserDataProfile } from "./userDataProfile"

export interface DidChangeUserDataProfileEvent {
  readonly previous: UserDataProfile
  readonly profile: UserDataProfile
  join(promise: Promise<void>): void
}

export interface DidChangeProfilesEvent {
  readonly added: readonly UserDataProfile[]
  readonly removed: readonly UserDataProfile[]
  readonly updated: readonly UserDataProfile[]
  readonly all: readonly UserDataProfile[]
}

export interface UserDataProfilesChange {
  added?: readonly UserDataProfile[]
  removed?: readonly UserDataProfile[]
  updated?: readonly UserDataProfile[]
  fireEvent?: boolean
}

export class UserDataProfileService extends Disposable {
  private readonly _onDidChangeCurrentProfile = this.register(new Emitter<DidChangeUserDataProfileEvent>())
  readonly onDidChangeCurrentProfile: Event<DidChangeUserDataProfileEvent> = this._onDidChangeCurrentProfile.event

  private _currentProfile: UserDataProfile

  get currentProfile(): UserDataProfile {
    return this._currentProfile
  }

  constructor(currentProfile: UserDataProfile) {
    super()
    this._currentProfile = currentProfile
  }

  async updateCurrentProfile(userDataProfile: UserDataProfile): Promise<void> {
    if (userDataProfileEquals(this._currentProfile, userDataProfile)) return
    const previous = this._currentProfile
    this._currentProfile = userDataProfile
    const joiners: Promise<void>[] = []
    this._onDidChangeCurrentProfile.fire({
      previous,
      profile: userDataProfile,
      join(promise) {
        joiners.push(promise)
      },
    })
    await Promise.allSettled(joiners)
  }
}

export class UserDataProfilesService extends Disposable {
  private readonly _onDidChangeProfiles = this.register(new Emitter<DidChangeProfilesEvent>())
  readonly onDidChangeProfiles: Event<DidChangeProfilesEvent> = this._onDidChangeProfiles.event
  private _profiles: UserDataProfile[]

  constructor(readonly defaultProfile: UserDataProfile, profiles: readonly UserDataProfile[] = []) {
    super()
    this._profiles = profiles.filter((profile) => !profile.isDefault)
  }

  get profiles(): readonly UserDataProfile[] {
    return this._profiles
  }

  updateProfiles(change: UserDataProfilesChange): void {
    const added = [...(change.added ?? [])]
    const removed = [...(change.removed ?? [])]
    const updated = [...(change.updated ?? [])]
    const removedIds = new Set(removed.map((profile) => profile.id))
    const updatedById = new Map(updated.map((profile) => [profile.id, profile]))
    const addedById = new Map(added.map((profile) => [profile.id, profile]))
    const next: UserDataProfile[] = []

    for (const profile of this._profiles) {
      if (removedIds.has(profile.id)) continue
      next.push(updatedById.get(profile.id) ?? addedById.get(profile.id) ?? profile)
      addedById.delete(profile.id)
    }

    for (const profile of addedById.values()) {
      if (!profile.isDefault) next.push(profile)
    }

    this._profiles = next
    if (change.fireEvent === false) return
    this._onDidChangeProfiles.fire({
      added,
      removed,
      updated,
      all: this.profiles,
    })
  }
}

export function userDataProfileEquals(a: UserDataProfile, b: UserDataProfile): boolean {
  return JSON.stringify(serializeUserDataProfile(a)) === JSON.stringify(serializeUserDataProfile(b))
}
