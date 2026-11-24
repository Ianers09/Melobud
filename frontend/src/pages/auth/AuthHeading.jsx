export default function AuthHeading({ title, children }) {
  return (
    <div className="mb-8">
      <h1 className="text-[26px] leading-tight font-extrabold">{title}</h1>
      {children && <p className="mt-2 text-[14px] text-ink-2">{children}</p>}
    </div>
  )
}
