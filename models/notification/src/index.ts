//
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021, 2022 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import activity, { type ActivityMessage } from '@hcengineering/activity'
import { type PersonSpace } from '@hcengineering/contact'
import {
  AccountRole,
  DOMAIN_MODEL,
  IndexKind,
  type Account,
  type AttachedDoc,
  type Class,
  type Collection,
  type Data,
  type Doc,
  type DocumentQuery,
  type IndexingConfiguration,
  type Markup,
  type Ref,
  type Space,
  type Timestamp,
  type Tx,
  type TxCUD,
  DOMAIN_TRANSIENT
} from '@hcengineering/core'
import {
  ArrOf,
  Index,
  Mixin,
  Model,
  Prop,
  TypeBoolean,
  TypeDate,
  TypeIntlString,
  TypeMarkup,
  TypeRef,
  UX,
  type Builder
} from '@hcengineering/model'
import core, { TClass, TDoc } from '@hcengineering/model-core'
import preference, { TPreference } from '@hcengineering/model-preference'
import view, { createAction, template } from '@hcengineering/model-view'
import workbench from '@hcengineering/model-workbench'
import {
  notificationId,
  DOMAIN_USER_NOTIFY,
  DOMAIN_NOTIFICATION,
  DOMAIN_DOC_NOTIFY,
  type ActivityInboxNotification,
  type ActivityNotificationViewlet,
  type BaseNotificationType,
  type BrowserNotification,
  type CommonInboxNotification,
  type CommonNotificationType,
  type DocNotifyContext,
  type InboxNotification,
  type MentionInboxNotification,
  type NotificationContextPresenter,
  type NotificationGroup,
  type NotificationObjectPresenter,
  type NotificationPreferencesGroup,
  type NotificationPreview,
  type NotificationProvider,
  type NotificationProviderDefaults,
  type NotificationProviderSetting,
  type NotificationTemplate,
  type NotificationType,
  type NotificationTypeSetting,
  type PushSubscription,
  type PushSubscriptionKeys
} from '@hcengineering/notification'
import { type Asset, type IntlString, type Resource } from '@hcengineering/platform'
import setting from '@hcengineering/setting'
import { type AnyComponent, type Location } from '@hcengineering/ui/src/types'

import notification from './plugin'

export { notificationId, DOMAIN_USER_NOTIFY, DOMAIN_NOTIFICATION, DOMAIN_DOC_NOTIFY } from '@hcengineering/notification'
export { notificationOperation } from './migration'
export { notification as default }

@Model(notification.class.BrowserNotification, core.class.Doc, DOMAIN_TRANSIENT)
export class TBrowserNotification extends TDoc implements BrowserNotification {
  senderId?: Ref<Account> | undefined
  tag!: Ref<Doc<Space>>
  title!: string
  body!: string
  onClickLocation?: Location | undefined
  user!: Ref<Account>
  messageId?: Ref<ActivityMessage>
  messageClass?: Ref<Class<ActivityMessage>>
  objectId!: Ref<Doc>
  objectClass!: Ref<Class<Doc>>
}

@Model(notification.class.PushSubscription, core.class.Doc, DOMAIN_USER_NOTIFY)
export class TPushSubscription extends TDoc implements PushSubscription {
  user!: Ref<Account>
  endpoint!: string
  keys!: PushSubscriptionKeys
}

@Model(notification.class.BaseNotificationType, core.class.Doc, DOMAIN_MODEL)
export class TBaseNotificationType extends TDoc implements BaseNotificationType {
  generated!: boolean
  label!: IntlString
  group!: Ref<NotificationGroup>
  defaultEnabled!: boolean
  hidden!: boolean
  templates?: NotificationTemplate
}

@Model(notification.class.NotificationType, notification.class.BaseNotificationType)
export class TNotificationType extends TBaseNotificationType implements NotificationType {
  txClasses!: Ref<Class<Tx>>[]
  objectClass!: Ref<Class<Doc>>
  onlyOwn?: boolean
}

@Model(notification.class.CommonNotificationType, notification.class.BaseNotificationType)
export class TCommonNotificationType extends TBaseNotificationType implements CommonNotificationType {}

@Model(notification.class.NotificationGroup, core.class.Doc, DOMAIN_MODEL)
export class TNotificationGroup extends TDoc implements NotificationGroup {
  label!: IntlString
  icon!: Asset
  // using for autogenerated settings
  objectClass?: Ref<Class<Doc>>
}

@Model(notification.class.NotificationPreferencesGroup, core.class.Doc, DOMAIN_MODEL)
export class TNotificationPreferencesGroup extends TDoc implements NotificationPreferencesGroup {
  label!: IntlString
  icon!: Asset
  presenter!: AnyComponent
}

@Model(notification.class.NotificationTypeSetting, preference.class.Preference)
export class TNotificationTypeSetting extends TPreference implements NotificationTypeSetting {
  declare attachedTo: Ref<TNotificationProvider>
  type!: Ref<BaseNotificationType>
  enabled!: boolean
}

@Model(notification.class.NotificationProviderSetting, preference.class.Preference)
export class TNotificationProviderSetting extends TPreference implements NotificationProviderSetting {
  declare attachedTo: Ref<TNotificationProvider>
  enabled!: boolean
}

@Mixin(notification.mixin.ClassCollaborators, core.class.Class)
export class TClassCollaborators extends TClass {
  fields!: string[]
}

@Mixin(notification.mixin.Collaborators, core.class.Doc)
@UX(notification.string.Collaborators)
export class TCollaborators extends TDoc {
  @Prop(ArrOf(TypeRef(core.class.Account)), notification.string.Collaborators)
  @Index(IndexKind.Indexed)
    collaborators!: Ref<Account>[]
}

@Mixin(notification.mixin.NotificationObjectPresenter, core.class.Class)
export class TNotificationObjectPresenter extends TClass implements NotificationObjectPresenter {
  presenter!: AnyComponent
}

@Mixin(notification.mixin.NotificationPreview, core.class.Class)
export class TNotificationPreview extends TClass implements NotificationPreview {
  presenter!: AnyComponent
}

@Mixin(notification.mixin.NotificationContextPresenter, core.class.Class)
export class TNotificationContextPresenter extends TClass implements NotificationContextPresenter {
  labelPresenter?: AnyComponent
}

@Model(notification.class.DocNotifyContext, core.class.Doc, DOMAIN_DOC_NOTIFY)
export class TDocNotifyContext extends TDoc implements DocNotifyContext {
  @Prop(TypeRef(core.class.Account), core.string.Account)
  @Index(IndexKind.Indexed)
    user!: Ref<Account>

  @Prop(TypeRef(core.class.Doc), core.string.Object)
  @Index(IndexKind.Indexed)
    objectId!: Ref<Doc>

  @Prop(TypeRef(core.class.Class), core.string.Class)
    objectClass!: Ref<Class<Doc>>

  @Prop(TypeRef(core.class.Space), core.string.Space)
    objectSpace!: Ref<Space>

  declare space: Ref<PersonSpace>

  @Prop(TypeDate(), core.string.Date)
    lastViewedTimestamp?: Timestamp

  @Prop(TypeDate(), core.string.Date)
    lastUpdateTimestamp?: Timestamp

  @Prop(TypeBoolean(), notification.string.Pinned)
    isPinned!: boolean

  @Prop(TypeBoolean(), view.string.Hide)
    hidden!: boolean

  tx?: Ref<TxCUD<Doc>>
}

@Model(notification.class.InboxNotification, core.class.Doc, DOMAIN_NOTIFICATION)
export class TInboxNotification extends TDoc implements InboxNotification {
  @Prop(TypeRef(notification.class.DocNotifyContext), core.string.AttachedTo)
  @Index(IndexKind.Indexed)
    docNotifyContext!: Ref<DocNotifyContext>

  @Prop(TypeRef(core.class.Account), core.string.Account)
  @Index(IndexKind.Indexed)
    user!: Ref<Account>

  @Prop(TypeBoolean(), core.string.Boolean)
  // @Index(IndexKind.Indexed)
    isViewed!: boolean

  @Prop(TypeBoolean(), core.string.Boolean)
    archived!: boolean

  objectId!: Ref<Doc>
  objectClass!: Ref<Class<Doc>>

  declare space: Ref<PersonSpace>

  title?: IntlString
  body?: IntlString
  intlParams?: Record<string, string | number>
  intlParamsNotLocalized?: Record<string, IntlString>
}

@Model(notification.class.ActivityInboxNotification, notification.class.InboxNotification)
export class TActivityInboxNotification extends TInboxNotification implements ActivityInboxNotification {
  @Prop(TypeRef(activity.class.ActivityMessage), core.string.AttachedTo)
    attachedTo!: Ref<ActivityMessage>

  @Prop(TypeRef(activity.class.ActivityMessage), core.string.AttachedToClass)
    attachedToClass!: Ref<Class<ActivityMessage>>
}

@Model(notification.class.CommonInboxNotification, notification.class.InboxNotification)
export class TCommonInboxNotification extends TInboxNotification implements CommonInboxNotification {
  @Prop(TypeIntlString(), core.string.String)
    header?: IntlString

  @Prop(TypeRef(core.class.Doc), core.string.Object)
    headerObjectId?: Ref<Doc>

  @Prop(TypeRef(core.class.Doc), core.string.Class)
    headerObjectClass?: Ref<Class<Doc>>

  @Prop(TypeIntlString(), notification.string.Message)
    message?: IntlString

  headerIcon?: Asset

  @Prop(TypeMarkup(), notification.string.Message)
    messageHtml?: Markup

  props?: Record<string, any>
  icon?: Asset
  iconProps?: Record<string, any>
}

@Model(notification.class.MentionInboxNotification, notification.class.CommonInboxNotification)
export class TMentionInboxNotification extends TCommonInboxNotification implements MentionInboxNotification {
  @Prop(TypeRef(core.class.Doc), core.string.Object)
    mentionedIn!: Ref<Doc>

  @Prop(TypeRef(core.class.Doc), core.string.Class)
    mentionedInClass!: Ref<Class<Doc>>
}

@Model(notification.class.ActivityNotificationViewlet, core.class.Doc, DOMAIN_MODEL)
export class TActivityNotificationViewlet extends TDoc implements ActivityNotificationViewlet {
  messageMatch!: DocumentQuery<Doc>

  presenter!: AnyComponent
}

@Model(notification.class.NotificationProvider, core.class.Doc)
export class TNotificationProvider extends TDoc implements NotificationProvider {
  icon!: Asset
  label!: IntlString
  description!: IntlString
  defaultEnabled!: boolean
  order!: number
  depends?: Ref<NotificationProvider>
  ignoreAll?: boolean
  canDisable!: boolean
  presenter?: AnyComponent
  isAvailableFn?: Resource<() => boolean>
}

@Model(notification.class.NotificationProviderDefaults, core.class.Doc)
export class TNotificationProviderDefaults extends TDoc implements NotificationProviderDefaults {
  provider!: Ref<NotificationProvider>
  excludeIgnore?: Ref<BaseNotificationType>[]
  ignoredTypes!: Ref<BaseNotificationType>[]
  enabledTypes!: Ref<BaseNotificationType>[]
}

export const notificationActionTemplates = template({
  pinContext: {
    action: notification.actionImpl.PinDocNotifyContext,
    label: notification.string.StarDocument,
    icon: view.icon.Star,
    input: 'focus',
    category: notification.category.Notification,
    target: notification.class.DocNotifyContext,
    visibilityTester: notification.function.HasDocNotifyContextPinAction,
    context: { mode: ['context', 'browser'], group: 'edit' }
  },
  unpinContext: {
    action: notification.actionImpl.UnpinDocNotifyContext,
    label: notification.string.UnstarDocument,
    icon: view.icon.Star,
    input: 'focus',
    category: notification.category.Notification,
    target: notification.class.DocNotifyContext,
    visibilityTester: notification.function.HasDocNotifyContextUnpinAction,
    context: { mode: ['context', 'browser'], group: 'edit' }
  }
})

export function createModel (builder: Builder): void {
  builder.createModel(
    TBrowserNotification,
    TNotificationType,
    TNotificationGroup,
    TNotificationPreferencesGroup,
    TClassCollaborators,
    TCollaborators,
    TNotificationObjectPresenter,
    TNotificationPreview,
    TDocNotifyContext,
    TInboxNotification,
    TActivityInboxNotification,
    TCommonInboxNotification,
    TNotificationContextPresenter,
    TActivityNotificationViewlet,
    TBaseNotificationType,
    TCommonNotificationType,
    TMentionInboxNotification,
    TPushSubscription,
    TNotificationProvider,
    TNotificationProviderSetting,
    TNotificationTypeSetting,
    TNotificationProviderDefaults
  )

  builder.mixin(notification.class.BrowserNotification, core.class.Class, core.mixin.TransientConfiguration, {
    broadcastOnly: true
  })

  builder.createDoc(
    setting.class.SettingsCategory,
    core.space.Model,
    {
      name: 'notifications',
      label: notification.string.Notifications,
      icon: notification.icon.Notifications,
      component: notification.component.NotificationSettings,
      group: 'settings-account',
      role: AccountRole.Guest,
      order: 1500
    },
    notification.ids.NotificationSettings
  )

  builder.createDoc(
    workbench.class.Application,
    core.space.Model,
    {
      label: notification.string.Inbox,
      icon: notification.icon.Notifications,
      locationDataResolver: notification.function.LocationDataResolver,
      alias: notificationId,
      hidden: true,
      locationResolver: notification.resolver.Location,
      component: notification.component.Inbox
    },
    notification.app.Inbox
  )

  createAction(builder, {
    action: workbench.actionImpl.Navigate,
    actionProps: {
      mode: 'app',
      application: notificationId
    },
    label: notification.string.Inbox,
    icon: view.icon.ArrowRight,
    input: 'none',
    category: view.category.Navigation,
    target: core.class.Doc,
    context: {
      mode: ['workbench', 'browser', 'editor', 'panel', 'popup']
    }
  })

  builder.createDoc(
    notification.class.NotificationGroup,
    core.space.Model,
    {
      label: notification.string.Notifications,
      icon: notification.icon.Notifications
    },
    notification.ids.NotificationGroup
  )

  builder.createDoc(
    notification.class.NotificationType,
    core.space.Model,
    {
      hidden: false,
      generated: false,
      label: notification.string.Collaborators,
      group: notification.ids.NotificationGroup,
      txClasses: [],
      objectClass: notification.mixin.Collaborators,
      defaultEnabled: true
    },
    notification.ids.CollaboratoAddNotification
  )

  builder.createDoc(notification.class.ActivityNotificationViewlet, core.space.Model, {
    presenter: notification.component.NotificationCollaboratorsChanged,
    messageMatch: {
      _class: activity.class.DocUpdateMessage,
      'attributeUpdates.attrClass': notification.mixin.Collaborators
    }
  })

  builder.createDoc(
    activity.class.DocUpdateMessageViewlet,
    core.space.Model,
    {
      objectClass: notification.mixin.Collaborators,
      action: 'update',
      icon: notification.icon.Notifications,
      label: notification.string.ChangeCollaborators
    },
    notification.ids.CollaboratorsChangedMessage
  )

  builder.mixin(notification.mixin.Collaborators, core.class.Class, activity.mixin.ActivityAttributeUpdatesPresenter, {
    presenter: notification.component.CollaboratorsChanged
  })

  createAction(
    builder,
    {
      action: notification.actionImpl.ReadNotifyContext,
      label: notification.string.MarkAsRead,
      icon: view.icon.Eye,
      input: 'focus',
      visibilityTester: notification.function.CanReadNotifyContext,
      category: notification.category.Notification,
      target: notification.class.DocNotifyContext,
      context: { mode: ['context', 'panel'], application: notification.app.Notification, group: 'edit' }
    },
    notification.action.ReadNotifyContext
  )

  createAction(
    builder,
    {
      action: notification.actionImpl.UnReadNotifyContext,
      label: notification.string.MarkAsUnread,
      icon: view.icon.EyeCrossed,
      input: 'focus',
      visibilityTester: notification.function.CanUnReadNotifyContext,
      category: notification.category.Notification,
      target: notification.class.DocNotifyContext,
      context: { mode: ['context', 'panel'], application: notification.app.Notification, group: 'edit' }
    },
    notification.action.UnReadNotifyContext
  )

  createAction(
    builder,
    {
      action: notification.actionImpl.ArchiveContextNotifications,
      label: view.string.Archive,
      icon: view.icon.CheckCircle,
      input: 'focus',
      category: notification.category.Notification,
      target: notification.class.DocNotifyContext,
      context: { mode: ['panel'], application: notification.app.Notification, group: 'remove' }
    },
    notification.action.ArchiveContextNotifications
  )

  createAction(
    builder,
    {
      action: notification.actionImpl.UnarchiveContextNotifications,
      label: view.string.UnArchive,
      icon: view.icon.Circle,
      input: 'focus',
      category: notification.category.Notification,
      target: notification.class.DocNotifyContext,
      context: { mode: ['panel'], application: notification.app.Notification, group: 'remove' }
    },
    notification.action.UnarchiveContextNotifications
  )

  createAction(
    builder,
    {
      action: notification.actionImpl.Unsubscribe,
      label: notification.string.Unsubscribe,
      icon: notification.icon.BellCrossed,
      input: 'focus',
      category: notification.category.Notification,
      target: notification.class.DocNotifyContext,
      context: {
        mode: ['panel'],
        group: 'remove'
      }
    },
    notification.action.Unsubscribe
  )

  builder.mixin(notification.class.DocNotifyContext, core.class.Class, view.mixin.ObjectPresenter, {
    presenter: notification.component.DocNotifyContextPresenter
  })

  builder.mixin(notification.class.ActivityInboxNotification, core.class.Class, view.mixin.ObjectPresenter, {
    presenter: notification.component.ActivityInboxNotificationPresenter
  })

  builder.mixin(notification.class.CommonInboxNotification, core.class.Class, view.mixin.ObjectPresenter, {
    presenter: notification.component.CommonInboxNotificationPresenter
  })

  builder.createDoc(
    notification.class.CommonNotificationType,
    core.space.Model,
    {
      label: activity.string.Mentions,
      generated: false,
      hidden: false,
      group: notification.ids.NotificationGroup,
      defaultEnabled: true,
      templates: {
        textTemplate: '{sender} mentioned you in {doc}: {message}',
        htmlTemplate: '<p><b>{sender}</b> mentioned you in {doc}:</p> <p>{message}</p> <p>{link}</p>',
        subjectTemplate: 'You were mentioned in {doc}'
      }
    },
    notification.ids.MentionCommonNotificationType
  )

  createAction(
    builder,
    {
      action: notification.actionImpl.ArchiveAll,
      label: notification.string.ArchiveAll,
      icon: view.icon.CheckCircle,
      input: 'none',
      category: notification.category.Notification,
      target: core.class.Doc,
      context: {
        mode: ['browser'],
        group: 'remove'
      }
    },
    notification.action.ArchiveAll
  )

  createAction(
    builder,
    {
      action: notification.actionImpl.ReadAll,
      label: notification.string.MarkReadAll,
      icon: view.icon.Eye,
      input: 'none',
      category: notification.category.Notification,
      target: core.class.Doc,
      context: {
        mode: ['browser'],
        group: 'edit'
      }
    },
    notification.action.ReadAll
  )

  createAction(
    builder,
    {
      action: notification.actionImpl.UnreadAll,
      label: notification.string.MarkUnreadAll,
      icon: view.icon.EyeCrossed,
      input: 'none',
      category: notification.category.Notification,
      target: core.class.Doc,
      context: {
        mode: ['browser'],
        group: 'edit'
      }
    },
    notification.action.UnreadAll
  )

  builder.createDoc(
    view.class.ActionCategory,
    core.space.Model,
    { label: notification.string.Inbox, visible: true },
    notification.category.Notification
  )

  builder.createDoc(notification.class.ActivityNotificationViewlet, core.space.Model, {
    messageMatch: {
      _class: activity.class.DocUpdateMessage,
      objectClass: activity.class.Reaction
    },
    presenter: notification.component.ReactionNotificationPresenter
  })

  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_NOTIFICATION,
    indexes: [{ keys: { user: 1, archived: 1, space: 1 } }],
    disabled: [{ modifiedOn: 1 }, { modifiedBy: 1 }, { createdBy: 1 }, { isViewed: 1 }, { hidden: 1 }]
  })

  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_DOC_NOTIFY,
    indexes: [{ keys: { user: 1 } }],
    disabled: [
      { _class: 1 },
      { modifiedOn: 1 },
      { modifiedBy: 1 },
      { createdBy: 1 },
      { isViewed: 1 },
      { hidden: 1 },
      { createdOn: -1 },
      { attachedTo: 1 },
      { space: 1 }
    ]
  })
  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_USER_NOTIFY,
    indexes: [{ keys: { user: 1 } }],
    disabled: [
      { _class: 1 },
      { modifiedOn: 1 },
      { modifiedBy: 1 },
      { createdBy: 1 },
      { isViewed: 1 },
      { hidden: 1 },
      { createdOn: -1 },
      { attachedTo: 1 }
    ]
  })
  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_USER_NOTIFY,
    indexes: [],
    disabled: [
      { _class: 1 },
      { modifiedOn: 1 },
      { modifiedBy: 1 },
      { createdBy: 1 },
      { isViewed: 1 },
      { hidden: 1 },
      { createdOn: -1 },
      { attachedTo: 1 }
    ]
  })

  builder.mixin<Class<DocNotifyContext>, IndexingConfiguration<DocNotifyContext>>(
    notification.class.DocNotifyContext,
    core.class.Class,
    core.mixin.IndexConfiguration,
    {
      searchDisabled: true,
      indexes: []
    }
  )

  builder.mixin<Class<InboxNotification>, IndexingConfiguration<InboxNotification>>(
    notification.class.InboxNotification,
    core.class.Class,
    core.mixin.IndexConfiguration,
    {
      searchDisabled: true,
      indexes: []
    }
  )
  builder.mixin<Class<BrowserNotification>, IndexingConfiguration<BrowserNotification>>(
    notification.class.BrowserNotification,
    core.class.Class,
    core.mixin.IndexConfiguration,
    {
      searchDisabled: true,
      indexes: []
    }
  )

  builder.mixin<Class<BrowserNotification>, IndexingConfiguration<BrowserNotification>>(
    notification.class.BrowserNotification,
    core.class.Class,
    core.mixin.IndexConfiguration,
    {
      searchDisabled: true,
      indexes: []
    }
  )

  builder.createDoc(notification.class.NotificationPreferencesGroup, core.space.Model, {
    label: notification.string.General,
    icon: notification.icon.Notifications,
    presenter: notification.component.GeneralPreferencesGroup
  })

  builder.createDoc(
    notification.class.NotificationProvider,
    core.space.Model,
    {
      icon: notification.icon.Inbox,
      label: notification.string.Inbox,
      description: notification.string.InboxNotificationsDescription,
      defaultEnabled: true,
      canDisable: false,
      order: 100
    },
    notification.providers.InboxNotificationProvider
  )

  builder.createDoc(
    notification.class.NotificationProvider,
    core.space.Model,
    {
      icon: notification.icon.Notifications,
      label: notification.string.Push,
      description: notification.string.PushNotificationsDescription,
      depends: notification.providers.InboxNotificationProvider,
      defaultEnabled: true,
      canDisable: true,
      order: 200
    },
    notification.providers.PushNotificationProvider
  )

  builder.createDoc(
    notification.class.NotificationProvider,
    core.space.Model,
    {
      icon: notification.icon.Notifications,
      label: notification.string.Sound,
      description: notification.string.SoundNotificationsDescription,
      depends: notification.providers.PushNotificationProvider,
      defaultEnabled: true,
      canDisable: true,
      ignoreAll: true,
      order: 250
    },
    notification.providers.SoundNotificationProvider
  )

  builder.createDoc(notification.class.NotificationProviderDefaults, core.space.Model, {
    provider: notification.providers.PushNotificationProvider,
    ignoredTypes: [notification.ids.CollaboratoAddNotification],
    enabledTypes: []
  })
}

export function generateClassNotificationTypes (
  builder: Builder,
  _class: Ref<Class<Doc>>,
  group: Ref<NotificationGroup>,
  ignoreKeys: string[] = [],
  defaultEnabled: string[] = []
): void {
  const hierarchy = builder.hierarchy
  const attributes = hierarchy.getAllAttributes(
    _class,
    hierarchy.isDerived(_class, core.class.AttachedDoc) ? core.class.AttachedDoc : core.class.Doc
  )
  const filtered = Array.from(attributes.values()).filter((p) => p.hidden !== true && p.readonly !== true)
  const enabledInboxTypes: Ref<BaseNotificationType>[] = []

  for (const attribute of filtered) {
    if (ignoreKeys.includes(attribute.name)) continue
    const isCollection: boolean = core.class.Collection === attribute.type._class
    const objectClass = !isCollection ? _class : (attribute.type as Collection<AttachedDoc>).of
    const txClasses = !isCollection
      ? hierarchy.isMixin(attribute.attributeOf)
        ? [core.class.TxMixin]
        : [core.class.TxUpdateDoc]
      : [core.class.TxCreateDoc, core.class.TxRemoveDoc]
    const data: Data<NotificationType> = {
      attribute: attribute._id,
      field: attribute.name,
      group,
      generated: true,
      objectClass,
      txClasses,
      hidden: false,
      defaultEnabled: false,
      templates: {
        textTemplate: '{body}',
        htmlTemplate: '<p>{body}</p>',
        subjectTemplate: '{doc} updated'
      },
      label: attribute.label
    }
    if (isCollection) {
      data.attachedToClass = _class
    }
    const id = `${notification.class.NotificationType}_${_class}_${attribute.name}` as Ref<NotificationType>
    builder.createDoc(notification.class.NotificationType, core.space.Model, data, id)

    if (defaultEnabled.includes(attribute.name)) {
      enabledInboxTypes.push(id)
    }
  }

  if (enabledInboxTypes.length > 0) {
    builder.createDoc(notification.class.NotificationProviderDefaults, core.space.Model, {
      provider: notification.providers.InboxNotificationProvider,
      ignoredTypes: [],
      enabledTypes: enabledInboxTypes
    })
  }
}
