import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  LoaderCircle,
  ArrowUpRight,
  LockKeyhole,
  Users,
  Globe2,
  CircleHelp,
} from "lucide-react";
import { statusLabels, visibilityLabels } from "../types";
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal ${wide ? "wide" : ""}`}
          aria-describedby={description ? "modal-description" : undefined}
        >
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description && (
                <Dialog.Description id="modal-description">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close className="icon-button" aria-label="닫기">
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value.toLowerCase()}`}>
      <i />
      {statusLabels[value] || value}
    </span>
  );
}
export function VisibilityIcon({
  value,
  size = 14,
}: {
  value: string;
  size?: number;
}) {
  return value === "COMPANY" ? (
    <Globe2 size={size} />
  ) : value === "RESTRICTED" ? (
    <Users size={size} />
  ) : (
    <LockKeyhole size={size} />
  );
}
export function VisibilityLabel({ value }: { value: string }) {
  return (
    <span className="inline muted">
      <VisibilityIcon value={value} />
      {visibilityLabels[value]}
    </span>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-shape">
        <CircleHelp size={26} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={23} />
      <span>불러오는 중...</span>
    </div>
  );
}
export function ErrorBox({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div role="alert" className="error-box">
      <span>{message}</span>
      {retry && (
        <button className="text-button" onClick={retry}>
          다시 시도 <ArrowUpRight size={14} />
        </button>
      )}
    </div>
  );
}
export function Avatar({
  name,
  index = 0,
  small = false,
}: {
  name: string;
  index?: number;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar avatar-${index % 5} ${small ? "small" : ""}`}
      title={name}
    >
      {name.slice(-2)}
    </span>
  );
}
