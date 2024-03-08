from common import Brand
from details import avtovaz, nissan, opel, renault


class Lada(Brand):

    extractor = avtovaz.AvtoVazDetails


class Nissan(Brand):

    extractor = nissan.NissanDetails


class Opel(Brand):

    extractor = opel.OpelDetails


class Renault(Brand):

    extractor = renault.RenaultDetails
