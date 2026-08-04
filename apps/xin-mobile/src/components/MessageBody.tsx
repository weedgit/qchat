import { Linking, Text, type StyleProp, type TextStyle } from "react-native";

/**
 * Lightweight text formatting for chat bubbles (mirror web MessageBody):
 * bold, italic, code, autolink, and @mentions.
 */
export function MessageBody({
  text,
  style,
  mentionStyle,
  linkStyle,
  codeStyle,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  mentionStyle?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  codeStyle?: StyleProp<TextStyle>;
}) {
  const pattern =
    /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|https?:\/\/[^\s<]+|@[a-zA-Z0-9_]+)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(
        <Text key={key++} style={style}>
          {text.slice(last, match.index)}
        </Text>
      );
    }
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <Text key={key++} style={[style, codeStyle]}>
          {token.slice(1, -1)}
        </Text>
      );
    } else if (
      (token.startsWith("**") && token.endsWith("**")) ||
      (token.startsWith("__") && token.endsWith("__"))
    ) {
      nodes.push(
        <Text key={key++} style={[style, { fontWeight: "700" }]}>
          {token.slice(2, -2)}
        </Text>
      );
    } else if (
      (token.startsWith("*") && token.endsWith("*")) ||
      (token.startsWith("_") && token.endsWith("_"))
    ) {
      nodes.push(
        <Text key={key++} style={[style, { fontStyle: "italic" }]}>
          {token.slice(1, -1)}
        </Text>
      );
    } else if (token.startsWith("http://") || token.startsWith("https://")) {
      const href = token.replace(/[.,)]+$/, "");
      const trailing = token.slice(href.length);
      nodes.push(
        <Text
          key={key++}
          style={[style, linkStyle, { textDecorationLine: "underline" }]}
          onPress={() => {
            void Linking.openURL(href).catch(() => {});
          }}
        >
          {href}
        </Text>
      );
      if (trailing) {
        nodes.push(
          <Text key={key++} style={style}>
            {trailing}
          </Text>
        );
      }
    } else if (token.startsWith("@")) {
      nodes.push(
        <Text key={key++} style={[style, mentionStyle]}>
          {token}
        </Text>
      );
    } else {
      nodes.push(
        <Text key={key++} style={style}>
          {token}
        </Text>
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length || nodes.length === 0) {
    nodes.push(
      <Text key={key++} style={style}>
        {text.slice(last)}
      </Text>
    );
  }
  return <Text style={style}>{nodes}</Text>;
}
