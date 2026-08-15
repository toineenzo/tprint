import {
  Anchor,
  Code,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useEffect, useState } from "react";

import { useStrings } from "../AppContext";
import { api } from "../api/client";
import { SecondaryButton } from "./ui/Buttons";

type HelpPage = {
  name: string;
  source: "wiki" | "bundled";
  markdown: string;
  pages: string[];
  url: string;
};

/**
 * Render the small slice of Markdown the wiki actually uses.
 *
 * A Markdown library is ~40KB for headings, lists, tables, code and links —
 * and the input isn't arbitrary, it's our own documentation. Anything not
 * handled falls through as plain text rather than as broken markup, and
 * nothing here interprets raw HTML, so a wiki edit can't inject any.
 */
function renderMarkdown(markdown: string, onNavigate: (page: string) => void) {
  const blocks: React.ReactNode[] = [];
  const lines = markdown.split("\n");
  let index = 0;
  let key = 0;

  const inline = (text: string): React.ReactNode => {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    // Links, then inline code, then bold — in that order so a link's label can
    // itself be styled. Everything else is left alone.
    const parts: React.ReactNode[] = [];
    // Bold before italic, or `**x**` would match the single-asterisk rule
    // twice and render a stray asterisk.
    const pattern =
      /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      if (match[1]) {
        // A wiki-internal target is another page of this same modal, so it
        // switches pages here instead of sending the reader to github.com for
        // something they already have open.
        const target = match[2];
        parts.push(
          target.startsWith("http") ? (
            <Anchor key={parts.length} href={target} target="_blank" rel="noreferrer">
              {match[1]}
            </Anchor>
          ) : (
            <Anchor
              key={parts.length}
              component="button"
              type="button"
              onClick={() => onNavigate(target)}
            >
              {match[1]}
            </Anchor>
          ),
        );
      } else if (match[3]) {
        parts.push(<Code key={parts.length}>{match[3]}</Code>);
      } else if (match[4]) {
        // Recursed, because the wiki writes **[Page](Page)** — matching bold
        // first and stopping there rendered the raw link syntax in bold.
        parts.push(<strong key={parts.length}>{inline(match[4])}</strong>);
      } else if (match[5]) {
        parts.push(<em key={parts.length}>{inline(match[5])}</em>);
      }
      last = pattern.lastIndex;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };

  while (index < lines.length) {
    const line = lines[index];

    if (line.startsWith("```")) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <Code key={key++} block style={{ whiteSpace: "pre-wrap" }}>
          {body.join("\n")}
        </Code>,
      );
      continue;
    }

    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index].startsWith("|")) {
        const cells = lines[index]
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim());
        // The |---|---| separator row carries no content.
        if (!cells.every((cell) => /^:?-{2,}:?$/.test(cell))) rows.push(cells);
        index += 1;
      }
      const [head, ...body] = rows;
      blocks.push(
        <Table key={key++} striped withTableBorder>
          {head && (
            <Table.Thead>
              <Table.Tr>
                {head.map((cell, i) => (
                  <Table.Th key={i}>{inline(cell)}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
          )}
          <Table.Tbody>
            {body.map((row, i) => (
              <Table.Tr key={i}>
                {row.map((cell, j) => (
                  <Table.Td key={j}>
                    <Text size="xs">{inline(cell)}</Text>
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <Title
          key={key++}
          order={Math.min(4, heading[1].length + 1) as 2 | 3 | 4}
          mt="sm"
        >
          {inline(heading[2])}
        </Title>,
      );
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <Stack key={key++} gap={2}>
          {items.map((item, i) => (
            <Text key={i} size="sm">
              • {inline(item)}
            </Text>
          ))}
        </Stack>,
      );
      continue;
    }

    if (line.trim()) {
      blocks.push(
        <Text key={key++} size="sm">
          {inline(line)}
        </Text>,
      );
    }
    index += 1;
  }

  return blocks;
}

/**
 * The project wiki, in a modal.
 *
 * Fetched through the server (`/api/settings/help`) rather than from the
 * browser: GitHub doesn't allow its wiki to be framed, and a cross-origin
 * fetch would be blocked. The server also falls back to the copy bundled in
 * the image, so help works on a network with no way out.
 */
export function HelpModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const t = useStrings();
  const [page, setPage] = useState("Home");
  const [doc, setDoc] = useState<HelpPage | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!opened) return;
    let stale = false;
    setLoading(true);
    void api
      .get<HelpPage>(`/api/settings/help?page=${encodeURIComponent(page)}`)
      .then((next) => {
        if (!stale) setDoc(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [opened, page]);

  return (
    <Modal opened={opened} onClose={onClose} title={t("help_title")} size="xl">
      <Stack gap="sm">
        <Group gap="xs" wrap="wrap">
          {(doc?.pages ?? ["Home"]).map((name) => (
            <SecondaryButton
              key={name}
              size="xs"
              onClick={() => setPage(name)}
              disabled={name === page}
            >
              {name.replace(/-/g, " ")}
            </SecondaryButton>
          ))}
        </Group>

        {loading && <Loader size="sm" />}

        {doc && (
          <Stack gap="xs">
            {renderMarkdown(doc.markdown, (target) => {
              // Unknown target: fall back to the wiki rather than blanking the
              // modal on a page this build doesn't ship.
              if (doc.pages.includes(target)) setPage(target);
              else window.open(`${doc.url}/${target}`, "_blank", "noreferrer");
            })}
            <Text size="xs" c="dimmed">
              {doc.source === "wiki" ? t("help_source_wiki") : t("help_source_bundled")}{" "}
              <Anchor href={doc.url} target="_blank" rel="noreferrer">
                {t("help_open_wiki")}
              </Anchor>
            </Text>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
