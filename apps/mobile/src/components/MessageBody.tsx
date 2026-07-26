import { Text, type StyleProp, type TextStyle } from "react-native";

/**
 * Lightweight @mention highlight for chat bubbles (mirrors web MessageBody).
 */
export function MessageBody({
  text,
  style,
  mentionStyle,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  mentionStyle?: StyleProp<TextStyle>;
}) {
  const pattern = /@[a-zA-Z0-9_]+/g;
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
    nodes.push(
      <Text key={key++} style={[style, mentionStyle]}>
        {match[0]}
      </Text>
    );
    last = match.index + match[0].length;
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
