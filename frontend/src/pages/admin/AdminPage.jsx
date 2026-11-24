import { PageHeader } from '../../components/ui'
import { useDocumentTitle } from '../../hooks/useResource'
import UsersTab from './UsersTab'

export default function AdminPage() {
  useDocumentTitle('Users')
  return (
    <>
      <PageHeader title="Users" description="Create, edit and remove Melobud accounts." />
      <UsersTab />
    </>
  )
}
