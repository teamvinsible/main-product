import { Modal } from "antd";
import type { ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

export function DetailModal({ open, title, subtitle, onClose, children, wide }: Props) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={wide ? 720 : 520}
      className="detail-modal"
      title={
        <div className="modal-head-copy">
          <span className="modal-title-text">{title}</span>
          {subtitle && <p className="modal-sub">{subtitle}</p>}
        </div>
      }
    >
      <div className="modal-body">{children}</div>
    </Modal>
  );
}
