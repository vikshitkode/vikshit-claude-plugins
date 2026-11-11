import AppKit

// Reads one word per line on stdin. Writes one line per word:
//   <word>\tok
//   <word>\tbad\t<guess>\t<guess>...   macOS's guesses, best first, at most 5
let checker = NSSpellChecker.shared
// A nil language lets macOS match a word against every installed dictionary,
// which accepts "teh" and "wich". The system's main spelling language does not.
let language = checker.language()
let input = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? ""
var output = ""

for line in input.split(whereSeparator: { $0.isNewline }) {
    let word = String(line)
    let whole = NSRange(location: 0, length: (word as NSString).length)
    let missed = checker.checkSpelling(
        of: word, startingAt: 0, language: language, wrap: false,
        inSpellDocumentWithTag: 0, wordCount: nil)

    if missed.location == NSNotFound {
        output += "\(word)\tok\n"
        continue
    }

    // The mod decides which guess is sure. `correction(forWordRange:)` would
    // answer the first guess for nearly every word, right or not.
    let guesses = checker.guesses(
        forWordRange: whole, in: word, language: language,
        inSpellDocumentWithTag: 0) ?? []
    output += "\(word)\tbad\t\(guesses.prefix(5).joined(separator: "\t"))\n"
}

FileHandle.standardOutput.write(Data(output.utf8))
