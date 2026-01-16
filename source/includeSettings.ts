export default interface IncludeSettings {
    commonmarkRegex?: boolean
    markdownItRegex?: boolean
    customPattern?: RegExp
    notFoundMessage?: string
    circularMessage?: string
    quoteFormatting?: boolean
    quoteIncludeSource?: boolean
    quoteSourceLabel?: string
    omissionIndicator?: boolean
}
