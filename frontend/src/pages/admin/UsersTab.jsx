import { useState } from 'react'
import { Lock, Pencil, Trash2, UserPlus, Users } from 'lucide-react'
import { Button, ConfirmDialog, ErrorAlert, Field, FormDialog, PasswordField, Switch } from '../../components/ui'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { adminApi } from '../../services/melobud'
import { formatDate, formatRelative } from '../../utils/format'
import { DataTable, Pagination, Pill, Select, Toolbar } from './shared'
import { useAdminList } from './useAdminList'

const EMPTY = { email: '', username: '', display_name: '', password: '', is_active: true, is_verified: true, is_staff: false }

function UserDialog({ target, onClose, onSaved }) {
  const { user: me } = useAuth()
  const toast = useToast()
  const creating = target === 'new'
  const [form, setForm] = useState(() => (creating ? EMPTY : { ...EMPTY, ...target, password: '' }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const isSelf = !creating && target.id === me.id
  const set = (name) => (value) => setForm((f) => ({ ...f, [name]: value }))

  const submit = async () => {
    setBusy(true)
    setErr(null)
    const payload = {
      email: form.email,
      username: form.username,
      display_name: form.display_name,
      is_active: form.is_active,
      is_verified: form.is_verified,
      is_staff: form.is_staff,
    }
    if (form.password) payload.password = form.password
    try {
      const saved = creating ? await adminApi.createUser(payload) : await adminApi.updateUser(target.id, payload)
      toast.success(creating ? `The account for ${saved.username} has been created.` : `The account for ${saved.username} has been updated.`)
      onSaved()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  const fieldErr = (name) => err?.fieldError?.(name) || null
  const generalErr = err && !['email', 'username', 'display_name', 'password'].some((n) => fieldErr(n)) ? err : null

  return (
    <FormDialog
      open={!!target}
      title={creating ? 'Create user' : 'Edit user'}
      description={creating ? 'The account can sign in immediately with the password you set.' : `Account created ${formatDate(target.date_joined)}.`}
      submitLabel={creating ? 'Create user' : 'Save changes'}
      busy={busy}
      onSubmit={submit}
      onCancel={onClose}
    >
      {generalErr && <ErrorAlert error={generalErr} />}
      <Field label="Email address" type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} error={fieldErr('email')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Username" value={form.username || ''} onChange={(e) => set('username')(e.target.value)} error={fieldErr('username')} />
        <Field label="Display name" hint="Optional" value={form.display_name} onChange={(e) => set('display_name')(e.target.value)} error={fieldErr('display_name')} />
      </div>
      <PasswordField
        label={creating ? 'Password' : 'New password'}
        hint={creating ? 'At least 8 characters.' : 'Leave blank to keep the current password. Setting a new one signs the user out everywhere.'}
        value={form.password}
        onChange={(e) => set('password')(e.target.value)}
        error={fieldErr('password')}
      />
      <div className="space-y-4 rounded-[10px] border border-line bg-bg/40 p-4">
        <Switch
          label="Active"
          description={isSelf ? 'You cannot deactivate your own account.' : 'Deactivated users cannot sign in.'}
          checked={form.is_active}
          onChange={set('is_active')}
          disabled={isSelf}
        />
        <Switch label="Email verified" description="Unverified users must confirm their email before using Melobud." checked={form.is_verified} onChange={set('is_verified')} />
        <Switch
          label="Administrator"
          description={
            isSelf ? 'You cannot remove your own administrator access.' : !me.is_superuser ? 'Only a superuser can change this.' : 'Grants access to user management.'
          }
          checked={form.is_staff}
          onChange={set('is_staff')}
          disabled={isSelf || !me.is_superuser}
        />
      </div>
    </FormDialog>
  )
}

export default function UsersTab() {
  const { user: me } = useAuth()
  const toast = useToast()
  const list = useAdminList(adminApi.users, { filter: '', sort: 'newest' })
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    try {
      await adminApi.deleteUser(deleting.id)
      toast.success(`The account for ${deleting.username || deleting.email} has been deleted.`)
      setDeleting(null)
      list.reload({ silent: true })
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const columns = [
    {
      key: 'user',
      label: 'User',
      render: (u) => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold">
            {u.username || '—'}
            {u.id === me.id && <span className="ml-2 text-[12px] font-normal text-ink-3">(you)</span>}
          </span>
          <span className="block truncate text-[12.5px] text-ink-3">{u.email}</span>
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (u) => (
        <span className="flex flex-wrap gap-1.5">
          {u.is_active ? <Pill tone="good">Active</Pill> : <Pill tone="bad">Deactivated</Pill>}
          {!u.is_verified && <Pill tone="brass">Unverified</Pill>}
          {u.is_superuser ? <Pill>Superuser</Pill> : u.is_staff ? <Pill>Administrator</Pill> : null}
        </span>
      ),
    },
    { key: 'songs', label: 'Songs', className: 'tabular md:text-right', render: (u) => <><span className="text-ink-3 md:hidden">Songs: </span>{u.songs}</> },
    { key: 'sessions', label: 'Sessions', className: 'tabular md:text-right', render: (u) => <><span className="text-ink-3 md:hidden">Sessions: </span>{u.sessions}</> },
    { key: 'joined', label: 'Joined', className: 'whitespace-nowrap text-ink-2', render: (u) => formatDate(u.date_joined) },
    { key: 'last', label: 'Last sign-in', className: 'whitespace-nowrap text-ink-2', render: (u) => (u.last_login ? formatRelative(u.last_login) : 'Never') },
    {
      key: 'actions',
      label: <span className="sr-only">Actions</span>,
      className: 'md:w-24 md:text-right',
      render: (u) =>
        u.is_superuser ? (
          <span className="flex h-8 items-center gap-1.5 text-[12.5px] text-ink-3 md:justify-end" title="Superuser accounts cannot be modified here">
            <Lock size={14} aria-hidden /> Protected
          </span>
        ) : (
        <span className="flex gap-1 md:justify-end" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${u.username || u.email}`} title="Edit" onClick={() => setEditing(u)} />
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            aria-label={`Delete ${u.username || u.email}`}
            title={u.id === me.id ? 'You cannot delete your own account here' : 'Delete'}
            disabled={u.id === me.id}
            onClick={() => setDeleting(u)}
          />
        </span>
      ),
    },
  ]

  return (
    <section className="panel overflow-hidden">
      <Toolbar search={list.search} onSearch={list.setSearch} placeholder="Search by email, username or name">
        <Select
          label="Filter users"
          value={list.filters.filter}
          onChange={(v) => list.setFilter('filter', v)}
          options={[
            { value: '', label: 'All users' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Deactivated' },
            { value: 'unverified', label: 'Unverified' },
            { value: 'staff', label: 'Administrators' },
          ]}
        />
        <Select
          label="Sort users"
          value={list.filters.sort}
          onChange={(v) => list.setFilter('sort', v)}
          options={[
            { value: 'newest', label: 'Newest first' },
            { value: 'oldest', label: 'Oldest first' },
            { value: 'username', label: 'Username' },
            { value: 'email', label: 'Email' },
            { value: 'last_login', label: 'Last sign-in' },
          ]}
        />
        <Button variant="primary" size="sm" icon={UserPlus} onClick={() => setEditing('new')}>
          Create user
        </Button>
      </Toolbar>
      <DataTable list={list} columns={columns} onRowClick={setEditing} canClick={(u) => !u.is_superuser} empty={{ icon: Users, title: 'No users found', children: 'Try a different search or filter.' }} />
      <Pagination data={list.data} onPage={list.setPage} />

      {editing && (
        <UserDialog
          key={editing === 'new' ? 'new' : editing.id}
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            list.reload({ silent: true })
          }}
        />
      )}
      <ConfirmDialog open={!!deleting} title="Delete this user?" confirmLabel="Delete user" busy={busy} onConfirm={remove} onCancel={() => setDeleting(null)}>
        <strong className="text-ink">{deleting?.username || deleting?.email}</strong> and all of their songs, audio files and sessions will be
        permanently deleted. This action cannot be undone.
      </ConfirmDialog>
    </section>
  )
}
