import { Button } from '../components/ui'
import { useDocumentTitle } from '../hooks/useResource'

export default function NotFoundPage() {
  useDocumentTitle('Not found')
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <p className="font-display text-[72px] leading-none font-extrabold tracking-[-0.04em] text-ink-3">404</p>
      <h1 className="mt-6 text-[22px] font-extrabold">Page not found</h1>
      <p className="mt-2 text-ink-2">The page you are looking for does not exist or you do not have access to it.</p>
      <Button to="/" variant="primary" className="mt-6">
        Go to dashboard
      </Button>
    </div>
  )
}
