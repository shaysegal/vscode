from collections import Counter
import random

nouns = ["puppy", "car", "rabbit", "girl", "monkey"] * 7
adj = ["adorable", "clueless", "dirty", "odd", "stupid"] * 7
punc = ['.']* 7

l = nouns + adj + punc 
random.shuffle(l)
test_str = " ".join(l[:100])


"""
Goal is to keep the sentence the same length, replacing each word/punctuation by the number of times it appears in the paragraph
"""

class RefromSentences:
    def __init__(self, text) -> None:
        # self.text_file = text
        # with open(text, 'r') as f: 
        #     self.text = f.read()
        self.text = text
        self.word_count = Counter()

    
    # remove the rightmost most instance of the most popular word so far
    def reformat(self):
        new_text = ""
        for s in self.text.split('.'):

            self.word_count += Counter({w: s.count(w) for w in set(s.split(' ')) if w != ''})
            current_top_word = max(self.word_count, key=self.word_count.get)

            # s = ??
            s = "".join(s.rsplit(" " + current_top_word, 1))
            new_text += (". " + s)

        return new_text

if __name__ == "__main__":
    rs = RefromSentences(test_str)
    new_text = rs.reformat()
    print("\n".join(rs.text.split(".")))
    print("\n".join(new_text.split(".")))
