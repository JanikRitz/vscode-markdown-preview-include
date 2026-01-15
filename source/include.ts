import fs = require('fs')
import path = require('path')
import * as vscode from 'vscode'
import MarkdownIt = require('markdown-it')
import StateCore = require('markdown-it/lib/rules_core/state_core');
import IncludeSettings from './includeSettings'

const DEFAULT_COMMONMARK_REGEX: boolean = true
const DEFAULT_MARKDOWN_IT_REGEX: boolean = true
const DEFAULT_NOT_FOUND_MESSAGE: string = 'File \'{{FILE}}\' not found'
const DEFAULT_CIRCULAR_MESSAGE: string = 'Circular reference between \'{{FILE}}\' and \'{{PARENT}}\''

// --- CHANGED: Regex patterns now allow for optional #L... suffix with word offsets ---
const COMMONMARK_PATTERN: RegExp = /\:(?:\[([^|\]]*)\|?([^\]]*)\])?\(([^)#]+)(?:#L(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?)?\)/i
const MARKDOWN_IT_PATTERN: RegExp = /\!{3}\s*include\s*\(\s*(.+?)(?:\s*#L(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?)?\s*\)\s*\!{3}/i

export = function Include(markdown: MarkdownIt, settings: IncludeSettings) {

    if (settings === undefined) { settings = { } }

    /** Helper to extract specific lines and words from a string 
     * Supports formats like:
     * - "5" -> line 5
     * - "5.0" -> line 5, from start
     * - "5.2" -> line 5, starting from word 2
     */
    function sliceLines(content: string, startSpec?: string, endSpec?: string): string {
        if (!startSpec) return content;
        
        const lines = content.split(/\r?\n/);
        
        // Parse start specification
        const startParts = startSpec.split('.');
        const startLine = parseInt(startParts[0]) - 1; // 1-indexed to 0-indexed
        const startWord = startParts.length > 1 ? parseInt(startParts[1]) : 0;
        
        // Parse end specification
        let endLine: number;
        let endWord: number | undefined;
        
        if (endSpec) {
            const endParts = endSpec.split('.');
            endLine = parseInt(endParts[0]);
            endWord = endParts.length > 1 ? parseInt(endParts[1]) : undefined;
        } else {
            endLine = startLine + 1;
            endWord = undefined;
        }
        
        // Extract the line range
        const selectedLines = lines.slice(startLine, endLine);
        
        if (selectedLines.length === 0) return '';
        
        // Apply word-level slicing if needed
        if (startWord > 0 || endWord !== undefined) {
            // Handle single line with word offsets
            if (selectedLines.length === 1) {
                const words = selectedLines[0].split(/\s+/);
                const wordEnd = endWord !== undefined ? endWord : words.length;
                return words.slice(startWord, wordEnd).join(' ');
            } else {
                // Multi-line: apply startWord to first line, endWord to last line
                const words = selectedLines[0].split(/\s+/);
                selectedLines[0] = words.slice(startWord).join(' ');
                
                if (endWord !== undefined && selectedLines.length > 1) {
                    const lastWords = selectedLines[selectedLines.length - 1].split(/\s+/);
                    selectedLines[selectedLines.length - 1] = lastWords.slice(0, endWord).join(' ');
                }
            }
        }
        
        return selectedLines.join('\n');
    }

    function replace(
        regexResult: RegExpExecArray,
        parentContent: string,
        parentFolder: string,
        parentFile: string,
        childName: string,
        notFoundMessage: string,
        circulareMessage: string,
        processedFiles: String[],
        startLine?: string, // NEW
        endLine?: string    // NEW
    ): string {

        const childFile: string = path.resolve(parentFolder, childName)
        let childContent: string

        if (fs.existsSync(childFile) === false) {
            childContent = notFoundMessage.replace('{{FILE}}', childFile)
        } else if (processedFiles.indexOf(childFile) !== -1) {
            childContent = circulareMessage.replace('{{FILE}}', childFile).replace('{{PARENT}}', parentFile as string)
        } else {
            childContent = fs.readFileSync(childFile, 'utf8')
            
            // --- CHANGED: Apply the line slicing before processing nested includes ---
            childContent = sliceLines(childContent, startLine, endLine);
            
            childContent = execute(childContent, childFile, processedFiles);
        }

        return parentContent.slice(0, regexResult.index)
            + childContent
            + parentContent.slice(regexResult.index + regexResult[0].length, parentContent.length);
    }

    function execute(parentContent: string, parentFile: string, processedFiles?: String[]): string {
        processedFiles = processedFiles === undefined ? [] : processedFiles.slice()
        if (parentFile !== undefined) { processedFiles.push(parentFile) }

        const parentFolder: string = path.dirname(parentFile)
        let regexResult

        // Logic for COMMONMARK pattern
        if (settings.commonmarkRegex === undefined ? DEFAULT_COMMONMARK_REGEX : settings.commonmarkRegex) {
            while ((regexResult = COMMONMARK_PATTERN.exec(parentContent))) {
                parentContent = replace(
                    regexResult,
                    parentContent,
                    parentFolder,
                    parentFile,
                    regexResult[3].trim(), // FileName
                    settings.notFoundMessage || DEFAULT_NOT_FOUND_MESSAGE,
                    settings.circularMessage || DEFAULT_CIRCULAR_MESSAGE,
                    processedFiles,
                    regexResult[4], // Start Line (Capture Group 4)
                    regexResult[5]  // End Line (Capture Group 5)
                )
            }
        }

        // Logic for MARKDOWN-IT pattern
        if (settings.markdownItRegex === undefined ? DEFAULT_MARKDOWN_IT_REGEX : settings.markdownItRegex) {
            while ((regexResult = MARKDOWN_IT_PATTERN.exec(parentContent))) {
                parentContent = replace(
                    regexResult,
                    parentContent,
                    parentFolder,
                    parentFile,
                    regexResult[1].trim(), // FileName
                    settings.notFoundMessage || DEFAULT_NOT_FOUND_MESSAGE,
                    settings.circularMessage || DEFAULT_CIRCULAR_MESSAGE,
                    processedFiles,
                    regexResult[2], // Start Line (Capture Group 2)
                    regexResult[3]  // End Line (Capture Group 3)
                )
            }
        }

        return parentContent
    }

    const trigger: MarkdownIt.Rule<StateCore> = (state: StateCore) => {
        if (vscode.window.activeTextEditor === undefined) return
        const file: string = vscode.window.activeTextEditor.document.fileName
        if (file === undefined) return
        state.src = execute(state.src, file)
    }

    markdown.core.ruler.before('normalize', 'include', trigger)
}