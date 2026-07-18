import { Button, Empty, Table, Tag } from "antd";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { SpineSnapshot } from "@teamvinsible/shared";
import { fetchSpine } from "../api";

function statusColor(status: string) {
  if (status === "ready") return "success";
  if (status === "needs-attention") return "warning";
  if (status === "cross-review") return "processing";
  return "default";
}

export function FilesPage() {
  const { project } = useParams();
  const [params] = useSearchParams();
  const highlight = params.get("spec");
  const [spine, setSpine] = useState<SpineSnapshot | null>(null);

  useEffect(() => {
    fetchSpine(project)
      .then(setSpine)
      .catch(() => setSpine(null));
  }, [project]);

  if (spine?.empty) {
    return (
      <div className="files-wrap fade-in">
        <div className="nav-mini">
          <Link to="/spine">← Coordination Spine</Link>
        </div>
        <h1>Files & specs</h1>
        <Empty description={spine.message} style={{ marginTop: 32 }}>
          <Link to="/intake">
            <Button type="primary">New brief</Button>
          </Link>
        </Empty>
      </div>
    );
  }

  const rows = (spine?.specs || []).map((spec) => ({
    key: spec.id,
    title: spec.title,
    path: spec.path || spec.summary,
    status: spec.status,
    owner: spec.owner,
    updatedAt: spec.updatedAt,
  }));

  return (
    <div className="files-wrap fade-in">
      <div className="nav-mini">
        <Link to={spine?.project ? `/spine/${encodeURIComponent(spine.project.id)}` : "/spine"}>
          ← Coordination Spine
        </Link>
      </div>
      <h1>Files & specs</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
        Artifacts written by the crew for {spine?.project?.title || project || "this run"}.
      </p>

      <div className="card" style={{ padding: 12 }}>
        <Table
          size="small"
          pagination={false}
          dataSource={rows}
          locale={{ emptyText: "No artifacts yet." }}
          rowClassName={(row) => (highlight === row.key ? "files-row-highlight" : "")}
          columns={[
            {
              title: "Artifact",
              dataIndex: "title",
              render: (title: string, row) => (
                <div>
                  <strong>{title}</strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {row.path}
                  </div>
                </div>
              ),
            },
            {
              title: "Status",
              dataIndex: "status",
              width: 140,
              render: (status: string) => <Tag color={statusColor(status)}>{status}</Tag>,
            },
            { title: "Owner", dataIndex: "owner", width: 120 },
            { title: "Updated", dataIndex: "updatedAt", width: 120 },
          ]}
        />
      </div>

      {(spine?.specs || []).length === 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          Specs appear here once agents write artifacts for this project.
        </p>
      )}
    </div>
  );
}
