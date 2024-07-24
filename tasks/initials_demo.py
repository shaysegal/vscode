"""
given a name, 
return the initials of that name in the pattern A.B capital case
"""
def initials(name:str)->str:
    result = name[0]+"."+name.split()[1][0]
    return result

if __name__ == "__main__":
    print(initials("Shay Segal")) #suppose to print S.S
    print(initials("Hila Peleg")) #suppose to print H.P
    print(initials("Guy Frankel")) #suppose to print G.F
    print(initials("Fourth Example")) #suppose to print F.E