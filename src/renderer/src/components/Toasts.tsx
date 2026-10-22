import { useStore } from '../store'
import { Icon } from './Icon'

export default function Toasts(): React.JSX.Element {
  const toasts = useStore((state) => state.toasts)
  const dismiss = useStore((state) => state.dismissToast)

  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`}>
          <Icon
            name={toast.kind === 'error' ? 'warning' : toast.kind === 'success' ? 'check' : 'mail'}
            size={16}
          />
          <span>{toast.message}</span>
          <button className="icon-btn tiny" onClick={() => dismiss(toast.id)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
